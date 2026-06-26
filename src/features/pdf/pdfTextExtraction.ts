import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/**
 * Position-aware PDF text item joiner.
 * Groups items by Y position (line), sorts lines top-to-bottom,
 * and items within each line left-to-right.
 * Avoids the naive item.str.join(' ') that garbles two-column layouts.
 */
export function joinPdfTextItemsBasic(items: TextItem[]): string {
  const nonEmpty = items.filter((item) => item.str?.trim().length > 0);
  const groups = new Map<number, TextItem[]>();

  for (const item of nonEmpty) {
    const y = item.transform?.[5] ?? 0;
    const roundedY = Math.round(y / 5) * 5;
    const group = groups.get(roundedY) ?? [];
    group.push(item);
    groups.set(roundedY, group);
  }

  return normalizeExtractedText(Array.from(groups.entries())
    .sort(([yA], [yB]) => yB - yA)
    .map(([, lineItems]) =>
      lineItems
        .sort((a, b) => (a.transform?.[4] ?? 0) - (b.transform?.[4] ?? 0))
        .map((item) => item.str.trim())
        .join(" "),
    )
    .join("\n"));
}

export function normalizeExtractedText(text: string): string {
  return text
    .replace(/-\n(?=\p{L})/gu, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export interface PageExtractionResult {
  pageNumber: number;
  text: string;
  charCount: number;
}

export type TextReadyStatus = "ready" | "empty" | "unavailable";

interface PageTextCoverage {
  page_number: number;
  text_status: string;
  char_count: number;
}

interface PageTextRow {
  text: string | null;
  text_status?: string;
  char_count?: number;
}

export interface TextReadinessOptions {
  pdf?: any;
  invoke?: typeof tauriInvoke;
  ocrPage?: (documentId: string, pageNumber: number, pdf: any) => Promise<TextReadyStatus>;
  onPhase?: (phase: string, pageNumber: number) => void;
  isCancelled?: () => boolean;
}

/**
 * Extract text from a single PDF page.
 */
export async function extractPageText(
  pdf: any,
  pageNumber: number,
): Promise<PageExtractionResult> {
  const page = await pdf.getPage(pageNumber);
  const textContent = await page.getTextContent();
  const text = joinPdfTextItemsBasic(textContent.items as TextItem[]);
  return {
    pageNumber,
    text,
    charCount: text.length,
  };
}

export function samplePagesForOpen(currentPage: number, pageCount: number): number[] {
  const pages = [1, currentPage]
    .filter((page) => Number.isFinite(page) && page >= 1 && page <= pageCount);
  return Array.from(new Set(pages));
}

/** Render one page and let the backend OCR + save it. */
export async function ocrPage(
  documentId: string,
  pageNumber: number,
  pdf: any,
  invokeFn: typeof tauriInvoke = tauriInvoke,
): Promise<TextReadyStatus> {
  if (!pdf) return "unavailable";
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 2 });
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

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return "unavailable";
  const imagePng = new Uint8Array(await blob.arrayBuffer());
  const status = await invokeFn<string>("ocr_page", { documentId, pageNumber, imagePng });
  return status === "ok" || status === "skipped" ? "ready" : "empty";
}

async function pageReady(documentId: string, pageNumber: number, invokeFn: typeof tauriInvoke) {
  const row = await invokeFn<PageTextRow | null>("get_page_text", { documentId, pageNumber });
  return !!(row?.text?.trim() || (row?.text_status === "ready" && (row.char_count ?? 0) > 0));
}

export async function ensurePagesTextReady(
  documentId: string,
  pages: number[],
  options: TextReadinessOptions = {},
): Promise<{ ready: number; failed: number }> {
  const invokeFn = options.invoke ?? tauriInvoke;
  const requestedPages = Array.from(new Set(pages.filter((page) => page >= 1))).sort((a, b) => a - b);
  if (requestedPages.length === 0) return { ready: 0, failed: 0 };

  for (const pageNumber of requestedPages) {
    if (options.isCancelled?.()) break;
    if (await pageReady(documentId, pageNumber, invokeFn)) continue;

    let nativeText = "";
    if (options.pdf) {
      options.onPhase?.("waiting_for_text", pageNumber);
      try {
        nativeText = (await extractPageText(options.pdf, pageNumber)).text;
      } catch {
        nativeText = "";
      }
    }

    if (nativeText.trim()) {
      await invokeFn("save_pages_text", {
        documentId,
        pages: [{ pageNumber, text: nativeText }],
      });
      continue;
    }

    if (options.pdf) {
      options.onPhase?.("ocr", pageNumber);
      await (options.ocrPage
        ? options.ocrPage(documentId, pageNumber, options.pdf)
        : ocrPage(documentId, pageNumber, options.pdf, invokeFn)
      ).catch(() => "unavailable");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const coverage = await invokeFn<PageTextCoverage[]>("get_pages_text_coverage", {
    documentId,
    startPage: requestedPages[0],
    endPage: requestedPages[requestedPages.length - 1],
  });
  const requested = new Set(requestedPages);
  const ready = coverage.filter((page) =>
    requested.has(page.page_number) && page.text_status === "ready" && page.char_count > 0
  ).length;
  return { ready, failed: requestedPages.length - ready };
}

export function ensureDocumentTextReady(
  documentId: string,
  pageCount: number,
  options: TextReadinessOptions = {},
): Promise<{ ready: number; failed: number }> {
  return ensurePagesTextReady(
    documentId,
    Array.from({ length: Math.max(0, pageCount) }, (_, i) => i + 1),
    options,
  );
}

/**
 * Priority-based page extraction queue.
 * Processes pages in priority order without blocking the reader.
 */
export class PageExtractionQueue {
  private pdf: any;
  private documentId: string;
  private saveBatchFn: (docId: string, pages: { pageNumber: number; text: string }[]) => Promise<void>;
  private failFn: (docId: string, pageNum: number) => Promise<void>;
  private queue: Map<number, number> = new Map(); // pageNumber → priority (lower = higher)
  private processing = false;
  private destroyed = false;
  private extracted = new Set<number>();
  /** Pages confirmed to have no text layer (scanned). OCR triggered on demand. */
  noTextPages = new Set<number>();
  private buffer: { pageNumber: number; text: string }[] = [];
  private totalPages = 0;
  private batchTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly BATCH_SIZE = 20;
  private readonly BATCH_MS = 3000;
  /** Optional progress callback: (extractedCount, totalPages) => void */
  onProgress: ((extracted: number, total: number) => void) | null = null;

  constructor(
    pdf: any,
    documentId: string,
    saveBatchFn: (docId: string, pages: { pageNumber: number; text: string }[]) => Promise<void>,
    failFn: (docId: string, pageNum: number) => Promise<void>,
  ) {
    this.pdf = pdf;
    this.documentId = documentId;
    this.saveBatchFn = saveBatchFn;
    this.failFn = failFn;
  }

  private flush(): void {
    if (this.batchTimeout) { clearTimeout(this.batchTimeout); this.batchTimeout = null; }
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    this.saveBatchFn(this.documentId, batch).catch(() => {
      // If batch save fails, fall back to saving one by one
      batch.forEach((p) => {
        this.saveBatchFn(this.documentId, [p]).catch(() =>
          this.failFn(this.documentId, p.pageNumber)
        );
      });
    });
  }

  private scheduleFlush(): void {
    if (this.buffer.length >= this.BATCH_SIZE) { this.flush(); return; }
    if (!this.batchTimeout) this.batchTimeout = setTimeout(() => this.flush(), this.BATCH_MS);
  }

  /**
   * Add a page to the extraction queue with the given priority.
   * Lower priority number = higher urgency.
   */
  addPage(pageNumber: number, priority: number): void {
    if (this.destroyed) return;
    if (this.extracted.has(pageNumber) || this.noTextPages.has(pageNumber)) return;
    const existing = this.queue.get(pageNumber);
    if (existing !== undefined && existing <= priority) return;
    this.queue.set(pageNumber, priority);
    this.schedule();
  }

  /**
   * Set the current page and enqueue nearby pages with appropriate priorities.
   */
  setCurrentPage(pageNumber: number, totalPages: number): void {
    this.totalPages = totalPages;
    // Priority 0: current page
    this.addPage(pageNumber, 0);
    // Priority 1: previous and next
    if (pageNumber > 1) this.addPage(pageNumber - 1, 1);
    if (pageNumber < totalPages) this.addPage(pageNumber + 1, 1);
    // Priority 2: a few more nearby
    if (pageNumber > 2) this.addPage(pageNumber - 2, 2);
    if (pageNumber + 2 <= totalPages) this.addPage(pageNumber + 2, 2);
  }

  /**
   * Enqueue all remaining pages at low priority.
   */
  enqueueAll(totalPages: number): void {
    for (let i = 1; i <= totalPages; i++) {
      if (!this.extracted.has(i) && !this.noTextPages.has(i) && !this.queue.has(i)) {
        this.queue.set(i, 4);
      }
    }
    this.schedule();
  }

  destroy(): void {
    this.destroyed = true;
    this.queue.clear();
    this.flush();
  }

  private async schedule(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (!this.destroyed && this.queue.size > 0) {
      // Sort by priority and pick the highest-priority page
      const entries = Array.from(this.queue.entries()).sort(([, a], [, b]) => a - b);
      const [pageNumber] = entries[0];
      this.queue.delete(pageNumber);

      if (this.extracted.has(pageNumber)) continue;

      try {
        const result = await extractPageText(this.pdf, pageNumber);
        if (this.destroyed) return;
        if (result.text.trim()) {
          this.extracted.add(pageNumber);
          this.buffer.push({ pageNumber, text: result.text });
          this.scheduleFlush();
          this.onProgress?.(this.extracted.size, this.totalPages);
        } else {
          // Scanned page — no text layer. OCR triggered on demand by AI workflow.
          this.noTextPages.add(pageNumber);
        }
      } catch (err) {
        if (this.destroyed) return;
        console.warn(`Failed to extract page ${pageNumber}:`, err);
        this.failFn(this.documentId, pageNumber).catch(() => {});
      }

      // Yield to UI thread every page
      await new Promise((r) => setTimeout(r, 0));
    }

    this.processing = false;
  }

  /** Flush any pending batch (call on idle/teardown) */
  flushPending(): void {
    this.flush();
  }
}
