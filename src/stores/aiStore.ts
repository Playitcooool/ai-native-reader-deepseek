import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { pagesNeededForWorkflow } from "../features/ai/workflowPages";
import { ensurePagesTextReady } from "../features/pdf/pdfTextExtraction";

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
    pageNumbers?: number[];
    pageCount?: number | null;
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

let cancelFlag = false;
let isWorkflowRunning = false;
let streamBuffer = "";
let streamTimer: ReturnType<typeof setTimeout> | null = null;

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
      const status = await ensurePagesTextReady(input.documentId, pages, {
        pdf: ocrPdfRef,
        isCancelled: () => cancelFlag,
        onPhase: (phase, pageNumber) => set({ aiPhase: `${phase}:${pageNumber}` }),
      });
      if (cancelFlag) return null;
      if (status.ready === 0) {
        const scope = pages.length === 1 ? `page ${pages[0]}` : "this range";
        throw new Error(`No readable text is available on ${scope}. Try a clearer scan or a smaller page range.`);
      }
      if (status.failed > 0 && pages.length === 1) {
        throw new Error(`No readable text is available on page${status.failedPages.length === 1 ? "" : "s"} ${status.failedPages.join(", ")}. Try a clearer scan or a smaller page range.`);
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
          page_numbers: input.pageNumbers ?? null,
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
         input.mode === "range_qa" && input.question ? input.question :
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
