import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { pagesNeededForWorkflow } from "../features/ai/workflowPages";
import { extractPageText } from "../features/pdf/pdfTextExtraction";

export interface AiMessage {
  id: string;
  session_id: string;
  role: string;
  content: string;
  page_number: number | null;
  context_snapshot_json: string | null;
  citations_json: string | null;
  created_at: string;
}

interface AiState {
  messages: AiMessage[];
  sessionId: string | null;
  isGenerating: boolean;
  aiPhase: string;
  streamingContent: string;
  lastWorkflowInput: Record<string, any> | null;
  setSessionId: (id: string | null) => void;
  addMessage: (msg: AiMessage) => void;
  setMessages: (msgs: AiMessage[]) => void;
  setGenerating: (g: boolean) => void;
  setStreamingContent: (content: string) => void;
  runWorkflow: (input: {
    documentId: string;
    documentTitle?: string;
    mode: string;
    pageNumber: number;
    selectedText?: string;
    startPage?: number;
    endPage?: number;
    question?: string;
    tocNodeId?: string;
  }) => Promise<string | null>;
  cancelWorkflow: () => void;
  retryLastWorkflow: () => Promise<string | null>;
  loadSessionMessages: (sessionId: string) => Promise<void>;
}

/** Pdfjs document proxy — set by PdfViewer on load, used for page rendering before OCR. */
let ocrPdfRef: any = null;

/** Set the pdfjs document for on-demand page rendering (called from PdfViewer). */
export function setOcrPdfRef(pdf: any) {
  ocrPdfRef = pdf;
}

type TextWaitStatus = "ready" | "empty" | "unavailable";

interface PageTextCoverage {
  page_number: number;
  text_status: string;
  char_count: number;
}

/** Run OCR on a single page via Rust backend leptess. Sends PNG bytes, saves to DB. */
async function ocrPage(documentId: string, pageNumber: number): Promise<TextWaitStatus> {
  if (!ocrPdfRef) return "unavailable";
  const page = await ocrPdfRef.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 2 }); // 2x for better OCR accuracy
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) { page.cleanup(); return "unavailable"; }
  try {
    await page.render({ canvasContext: ctx, viewport }).promise;
  } finally {
    page.cleanup();
  }

  // Canvas → PNG blob → Uint8Array (binary IPC)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return "unavailable";
  const pngBytes = new Uint8Array(await blob.arrayBuffer());

  // Rust handles OCR + DB save in one call; throws on failure with backend error message
  const status = await invoke<string>("ocr_page", {
    documentId,
    pageNumber,
    imagePng: pngBytes,
  });

  return status === "ok" || status === "skipped" ? "ready" : "empty";
}

let cancelFlag = false;
let isWorkflowRunning = false;
let streamBuffer = "";
let streamTimer: ReturnType<typeof setTimeout> | null = null;

/** Poll for page text; run OCR for scanned pages before giving up. */
async function waitForPageText(
  documentId: string,
  pageNumber: number,
  timeoutMs = 30000,
  onOcrStart?: () => void,
): Promise<TextWaitStatus> {
  const deadline = Date.now() + timeoutMs;
  let ocrPromise: Promise<TextWaitStatus> | null = null;
  while (true) {
    if (cancelFlag) return "unavailable";
    const result = await invoke<{ text: string | null } | null>("get_page_text", {
      documentId,
      pageNumber,
    });
    if (result?.text?.trim()) return "ready";

    // After 1s of no text, assume scanned page and trigger OCR
    if (!ocrPromise && Date.now() - (deadline - timeoutMs) > 1000) {
      onOcrStart?.();
      ocrPromise = ocrPage(documentId, pageNumber);
    }

    if (ocrPromise) {
      if (Date.now() >= deadline) return "unavailable";
      const status = await Promise.race([
        ocrPromise,
        new Promise<"pending">((r) => setTimeout(() => r("pending"), 200)),
      ]);
      if (status !== "pending") return status;
    } else {
      if (Date.now() >= deadline) {
        console.warn(`waitForPageText: page ${pageNumber} not available after ${timeoutMs}ms`);
        return "unavailable";
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

async function ensurePagesReadyForWorkflow(
  documentId: string,
  pages: number[],
  set: any,
): Promise<{ ready: number; failed: number }> {
  const coverage = await invoke<PageTextCoverage[]>("get_pages_text_coverage", {
    documentId,
    startPage: pages[0],
    endPage: pages[pages.length - 1],
  });
  const missing = coverage
    .filter((page) => page.text_status !== "ready" || page.char_count <= 0)
    .map((page) => page.page_number);

  if (missing.length && ocrPdfRef) {
    const textPages: { pageNumber: number; text: string }[] = [];
    const scanned: number[] = [];
    await runPool(missing, 3, async (pageNumber) => {
      if (cancelFlag) return;
      set({ aiPhase: `waiting_for_text:${pageNumber}` });
      try {
        const result = await extractPageText(ocrPdfRef, pageNumber);
        if (result.text.trim()) {
          textPages.push({ pageNumber, text: result.text });
        } else {
          scanned.push(pageNumber);
        }
      } catch {
        scanned.push(pageNumber);
      }
    });
    if (textPages.length) {
      await invoke("save_pages_text", { documentId, pages: textPages });
    }
    await runPool(scanned, 1, async (pageNumber) => {
      if (cancelFlag) return;
      set({ aiPhase: `ocr:${pageNumber}` });
      await ocrPage(documentId, pageNumber).catch(() => "unavailable");
    });
  }

  const finalCoverage = await invoke<PageTextCoverage[]>("get_pages_text_coverage", {
    documentId,
    startPage: pages[0],
    endPage: pages[pages.length - 1],
  });
  const ready = finalCoverage.filter((page) => page.text_status === "ready" && page.char_count > 0).length;
  return { ready, failed: pages.length - ready };
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  }));
}

function flushStreamBuffer(set: any) {
  if (streamBuffer) {
    set((s: AiState) => ({ streamingContent: s.streamingContent + streamBuffer }));
    streamBuffer = "";
  }
  streamTimer = null;
}

export const useAiStore = create<AiState>((set, get) => ({
  messages: [],
  sessionId: null,
  isGenerating: false,
  aiPhase: "",
  streamingContent: "",
  lastWorkflowInput: null,
  setSessionId: (id) => set({ sessionId: id }),
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setMessages: (msgs) => set({ messages: msgs }),
  setGenerating: (g) => set({ isGenerating: g }),
  setStreamingContent: (content) => set({ streamingContent: content }),

  runWorkflow: async (input) => {
    if (isWorkflowRunning) throw new Error("An AI workflow is already running.");
    isWorkflowRunning = true;
    set({ isGenerating: true, aiPhase: "building_context", streamingContent: "", lastWorkflowInput: input as Record<string, any> });

    let unlisten: UnlistenFn[] = [];
    cancelFlag = false;

    try {
      // Listen for phase changes
      const phaseUnlisten = await listen<{ phase: string }>("ai-phase-change", (event) => {
        set({ aiPhase: event.payload.phase });
      });
      unlisten.push(phaseUnlisten);
      // Listen for streaming tokens from backend (debounced)
      const tokenUnlisten = await listen<{ token: string }>("ai-stream-chunk", (event) => {
        streamBuffer += event.payload.token;
        if (!streamTimer) {
          streamTimer = setTimeout(() => flushStreamBuffer(set), 50);
        }
      });
      unlisten.push(tokenUnlisten);

      // Wait for target page text/OCR before calling AI.
      const pages = pagesNeededForWorkflow(input);
      if (pages.length === 1) {
        const p = pages[0];
        if (cancelFlag) return null;
        set({ aiPhase: `waiting_for_text:${p}` });
        const status = await waitForPageText(input.documentId, p, 30000, () =>
          set({ aiPhase: `ocr:${p}` }),
        );
        if (status !== "ready") {
          const reason = status === "empty"
            ? `OCR finished but found no readable text on page ${p}.`
            : `Could not extract text from page ${p}.`;
          throw new Error(`${reason} Try a clearer scan or a smaller page range.`);
        }
      } else {
        const status = await ensurePagesReadyForWorkflow(input.documentId, pages, set);
        if (status.ready === 0) {
          throw new Error("No readable text is available in this range. Try a clearer scan or a smaller page range.");
        }
        if (status.failed > 0) {
          console.warn(`AI range query continuing with ${status.ready}/${pages.length} readable pages.`);
        }
      }

      const result = await invoke<{
        message_id: string;
        session_id: string;
        answer_md: string;
        context_snapshot: any;
      }>("run_ai_workflow", {
        input: {
          document_id: input.documentId,
          document_title: input.documentTitle ?? null,
          mode: input.mode,
          page_number: input.pageNumber,
          selected_text: input.selectedText ?? null,
          start_page: input.startPage ?? null,
          end_page: input.endPage ?? null,
          question: input.question ?? null,
          existing_session_id: get().sessionId,
          toc_node_id: input.tocNodeId ?? null,
        },
      });

      if (streamTimer) { clearTimeout(streamTimer); streamTimer = null; }
      flushStreamBuffer(set);
      if (cancelFlag) return null;

      set({ sessionId: result.session_id });

      // Add messages to local state
      const now = new Date().toISOString();
      const userContent = input.selectedText ?? input.question ??
        (input.mode === "page_summary" ? `Summarize page ${input.pageNumber}` :
         input.mode === "range_summary" && input.startPage && input.endPage ? `Summarize pages ${input.startPage}–${input.endPage}` :
         input.mode);
      const userMsg: AiMessage = {
        id: `user_${Date.now()}`,
        session_id: result.session_id,
        role: "user",
        content: userContent,
        page_number: input.pageNumber,
        context_snapshot_json: null,
        citations_json: null,
        created_at: now,
      };
      const asstMsg: AiMessage = {
        id: result.message_id,
        session_id: result.session_id,
        role: "assistant",
        content: result.answer_md,
        page_number: input.pageNumber,
        context_snapshot_json: JSON.stringify(result.context_snapshot),
        citations_json: null,
        created_at: now,
      };

      set((s) => ({
        messages: [...s.messages, userMsg, asstMsg],
        streamingContent: "",
      }));

      return result.answer_md;
    } catch (err) {
      console.error("aiStore.runWorkflow failed:", err);
      throw err;
    } finally {
      unlisten.forEach((u) => u());
      if (streamTimer) { clearTimeout(streamTimer); streamTimer = null; }
      streamBuffer = "";
      cancelFlag = false;
      isWorkflowRunning = false;
      set({ isGenerating: false, aiPhase: "", streamingContent: "" });
    }
  },

  cancelWorkflow: () => {
    cancelFlag = true;
    set({ isGenerating: false, streamingContent: "" });
  },

  retryLastWorkflow: async () => {
    const last = get().lastWorkflowInput;
    if (!last) return null;
    return get().runWorkflow(last as any);
  },

  loadSessionMessages: async (sessionId) => {
    try {
      const msgs = await invoke<AiMessage[]>("get_session_messages", {
        sessionId,
        limit: 50,
      });
      set({ messages: msgs, sessionId });
    } catch (err) {
      console.error("Failed to load session messages:", err);
    }
  },
}));
