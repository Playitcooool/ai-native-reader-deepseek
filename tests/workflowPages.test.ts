import { describe, expect, it } from "vitest";
import { pagesNeededForWorkflow } from "../src/features/ai/workflowPages";

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
});
