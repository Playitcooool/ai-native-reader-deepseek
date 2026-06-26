import { describe, expect, it } from "vitest";
import { pagesNeededForWorkflow } from "../src/features/ai/workflowPages";
import { inferAskScope } from "../src/features/ai/promptScope";
import { samplePagesForOpen } from "../src/features/pdf/pdfTextExtraction";
import type { TocNode } from "../src/features/toc/TocSidebar";

describe("pagesNeededForWorkflow", () => {
  it("waits for every page in a summary range", () => {
    expect(pagesNeededForWorkflow({
      mode: "range_summary",
      pageNumber: 10,
      startPage: 5,
      endPage: 3,
    })).toEqual([3, 4, 5]);
  });

  it("waits for the current page for non-range workflows", () => {
    expect(pagesNeededForWorkflow({ mode: "page_summary", pageNumber: 23 })).toEqual([23]);
  });

  it("waits for every page in a ranged chapter question", () => {
    expect(pagesNeededForWorkflow({
      mode: "chapter_qa",
      pageNumber: 3,
      startPage: 3,
      endPage: 5,
    })).toEqual([3, 4, 5]);
  });

  it("waits for every page in explicit range questions", () => {
    expect(pagesNeededForWorkflow({
      mode: "range_qa",
      pageNumber: 20,
      startPage: 20,
      endPage: 21,
    })).toEqual([20, 21]);
  });
});

describe("samplePagesForOpen", () => {
  it("samples page 1 and the current page", () => {
    expect(samplePagesForOpen(7, 20)).toEqual([1, 7]);
  });

  it("deduplicates and clamps samples", () => {
    expect(samplePagesForOpen(1, 20)).toEqual([1]);
    expect(samplePagesForOpen(30, 20)).toEqual([1]);
  });
});

const tocNode: TocNode = {
  id: "chapter-1",
  document_id: "doc-1",
  parent_id: null,
  title: "Chapter 1",
  level: 0,
  order_index: 0,
  start_page: 3,
  end_page: 9,
  source: "native",
  confidence: 1,
};

describe("inferAskScope", () => {
  it("keeps page questions page-scoped", () => {
    expect(inferAskScope("what does this page say?", 4, [tocNode])).toEqual({ kind: "page" });
  });

  it("uses explicit page ranges in questions", () => {
    expect(inferAskScope("what does page 20-21 say?", 4, [tocNode])).toEqual({
      kind: "range",
      startPage: 20,
      endPage: 21,
    });
    expect(inferAskScope("what does page 20 -21 say?", 4, [tocNode])).toEqual({
      kind: "range",
      startPage: 20,
      endPage: 21,
    });
    expect(inferAskScope("compare pages 20 and 21", 4, [tocNode])).toEqual({
      kind: "range",
      startPage: 20,
      endPage: 21,
    });
  });

  it("uses explicit single pages in questions", () => {
    expect(inferAskScope("what does page 21 say?", 4, [tocNode])).toEqual({
      kind: "range",
      startPage: 21,
      endPage: 21,
    });
    expect(inferAskScope("what does p. 20 say?", 4, [tocNode])).toEqual({
      kind: "range",
      startPage: 20,
      endPage: 20,
    });
  });

  it("does not treat dates as page ranges", () => {
    expect(inferAskScope("what changed in 2020-2021?", 4, [tocNode])).toEqual({ kind: "page" });
  });

  it("uses the active section for chapter questions", () => {
    expect(inferAskScope("summarize this chapter", 4, [tocNode])).toEqual({
      kind: "section",
      node: tocNode,
      startPage: 3,
      endPage: 9,
    });
  });

  it("detects Chinese section terms", () => {
    expect(inferAskScope("总结本章", 4, [tocNode])).toMatchObject({ kind: "section" });
  });
});
