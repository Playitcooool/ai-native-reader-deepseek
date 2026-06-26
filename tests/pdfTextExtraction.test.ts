import { describe, expect, it, vi } from "vitest";
import {
  ensureDocumentTextReady,
  ensurePagesTextReady,
  normalizeExtractedText,
} from "../src/features/pdf/pdfTextExtraction";

describe("normalizeExtractedText", () => {
  it("cleans common PDF line wrap artifacts", () => {
    expect(normalizeExtractedText("concentra-\ntion   inequality \nnext")).toBe("concentration inequality\nnext");
  });
});

function fakePdf(textByPage: Record<number, string>) {
  return {
    getPage: vi.fn(async (pageNumber: number) => ({
      getTextContent: async () => ({
        items: textByPage[pageNumber]
          ? [{ str: textByPage[pageNumber], transform: [1, 0, 0, 1, 0, 0] }]
          : [],
      }),
    })),
  };
}

function mockInvoke(initialReady: Record<number, string> = {}) {
  const saved = new Map<number, string>(Object.entries(initialReady).map(([page, text]) => [Number(page), text]));
  const invoke = vi.fn(async (command: string, args: any) => {
    if (command === "get_page_text") {
      const text = saved.get(args.pageNumber);
      return text ? { text, text_status: "ready", char_count: text.length } : null;
    }
    if (command === "save_pages_text") {
      for (const page of args.pages) saved.set(page.pageNumber, page.text);
      return null;
    }
    if (command === "get_pages_text_coverage") {
      const rows = [];
      for (let page = args.startPage; page <= args.endPage; page++) {
        const text = saved.get(page) ?? "";
        rows.push({
          page_number: page,
          text_status: text ? "ready" : "missing",
          char_count: text.length,
        });
      }
      return rows;
    }
    throw new Error(`unexpected command ${command}`);
  });
  return { invoke, saved };
}

describe("ensurePagesTextReady", () => {
  it("uses native PDF text without OCR", async () => {
    const { invoke } = mockInvoke();
    const ocrPage = vi.fn();

    const result = await ensurePagesTextReady("doc", [2], {
      pdf: fakePdf({ 2: "native text" }),
      invoke: invoke as any,
      ocrPage,
    });

    expect(result).toEqual({ ready: 1, failed: 0, readyPages: [2], failedPages: [] });
    expect(ocrPage).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("save_pages_text", {
      documentId: "doc",
      pages: [{ pageNumber: 2, text: "native text" }],
    });
  });

  it("OCRs pages with blank native text", async () => {
    const { invoke, saved } = mockInvoke();
    const ocrPage = vi.fn(async (_documentId: string, pageNumber: number) => {
      saved.set(pageNumber, "ocr text");
      return "ready" as const;
    });

    const result = await ensurePagesTextReady("doc", [3], {
      pdf: fakePdf({ 3: "" }),
      invoke: invoke as any,
      ocrPage,
    });

    expect(result).toEqual({ ready: 1, failed: 0, readyPages: [3], failedPages: [] });
    expect(ocrPage).toHaveBeenCalledOnce();
  });

  it("current-page flow touches one page", async () => {
    const { invoke } = mockInvoke();
    const pdf = fakePdf({ 5: "page five" });

    await ensurePagesTextReady("doc", [5], { pdf, invoke: invoke as any });

    expect(pdf.getPage).toHaveBeenCalledWith(5);
    expect(pdf.getPage).toHaveBeenCalledTimes(1);
  });

  it("range flow touches only the requested range", async () => {
    const { invoke } = mockInvoke();
    const pdf = fakePdf({ 2: "two", 3: "three", 4: "four" });

    await ensurePagesTextReady("doc", [2, 3, 4], { pdf, invoke: invoke as any });

    expect(pdf.getPage.mock.calls.map(([page]: [number]) => page)).toEqual([2, 3, 4]);
  });

  it("reports exact failed pages", async () => {
    const { invoke } = mockInvoke();
    const pdf = fakePdf({ 20: "twenty", 21: "" });

    const result = await ensurePagesTextReady("doc", [20, 21], {
      pdf,
      invoke: invoke as any,
      ocrPage: vi.fn(async () => "empty" as const),
    });

    expect(result).toEqual({ ready: 1, failed: 1, readyPages: [20], failedPages: [21] });
  });

  it("document search readiness requests all pages", async () => {
    const { invoke } = mockInvoke();
    const pdf = fakePdf({ 1: "one", 2: "two", 3: "three" });

    await ensureDocumentTextReady("doc", 3, { pdf, invoke: invoke as any });

    expect(pdf.getPage.mock.calls.map(([page]: [number]) => page)).toEqual([1, 2, 3]);
  });
});
