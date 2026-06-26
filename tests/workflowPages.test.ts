import { describe, expect, it } from "vitest";
import { pagesNeededForWorkflow } from "../src/features/ai/workflowPages";
import { inferAskScope } from "../src/features/ai/promptScope";
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
