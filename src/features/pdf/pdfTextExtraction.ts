import type { TextItem } from "pdfjs-dist/types/src/display/api";

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

  return Array.from(groups.entries())
    .sort(([yA], [yB]) => yB - yA)
    .map(([, lineItems]) =>
      lineItems
        .sort((a, b) => (a.transform?.[4] ?? 0) - (b.transform?.[4] ?? 0))
        .map((item) => item.str.trim())
        .join(" "),
    )
    .join("\n");
}

export interface PageExtractionResult {
  pageNumber: number;
  text: string;
  charCount: number;
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

/**
 * Priority-based page extraction queue.
 * Processes pages in priority order without blocking the reader.
 */
export class PageExtractionQueue {
  private pdf: any;
  private documentId: string;
  private saveFn: (docId: string, pageNum: number, text: string) => Promise<void>;
  private failFn: (docId: string, pageNum: number) => Promise<void>;
  private queue: Map<number, number> = new Map(); // pageNumber → priority (lower = higher)
  private processing = false;
  private destroyed = false;
  private extracted = new Set<number>();
  private totalPages = 0;
  /** Optional progress callback: (extractedCount, totalPages) => void */
  onProgress: ((extracted: number, total: number) => void) | null = null;

  constructor(
    pdf: any,
    documentId: string,
    saveFn: (docId: string, pageNum: number, text: string) => Promise<void>,
    failFn: (docId: string, pageNum: number) => Promise<void>,
  ) {
    this.pdf = pdf;
    this.documentId = documentId;
    this.saveFn = saveFn;
    this.failFn = failFn;
  }

  /**
   * Add a page to the extraction queue with the given priority.
   * Lower priority number = higher urgency.
   */
  addPage(pageNumber: number, priority: number): void {
    if (this.destroyed) return;
    if (this.extracted.has(pageNumber)) return;
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
      if (!this.extracted.has(i) && !this.queue.has(i)) {
        this.queue.set(i, 4);
      }
    }
    this.schedule();
  }

  destroy(): void {
    this.destroyed = true;
    this.queue.clear();
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
        this.extracted.add(pageNumber);
        await this.saveFn(this.documentId, pageNumber, result.text);
        this.onProgress?.(this.extracted.size, this.totalPages);
      } catch (err) {
        if (this.destroyed) return;
        console.warn(`Failed to extract page ${pageNumber}:`, err);
        await this.failFn(this.documentId, pageNumber).catch(() => {});
      }

      // Yield to UI thread every page
      await new Promise((r) => setTimeout(r, 0));
    }

    this.processing = false;
  }
}
