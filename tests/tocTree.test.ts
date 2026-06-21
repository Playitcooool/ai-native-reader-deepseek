import { describe, it, expect } from "vitest";
import { computeEndPages, type TocNodeInput } from "../src/features/toc/tocTree";

describe("computeEndPages", () => {
  it("computes end pages for flat list", () => {
    const nodes: TocNodeInput[] = [
      { parent_id: null, title: "Ch 1", level: 0, order_index: 1, start_page: 10, end_page: null },
      { parent_id: null, title: "Ch 2", level: 0, order_index: 2, start_page: 30, end_page: null },
    ];
    const result = computeEndPages(nodes, 50);
    expect(result[0].end_page).toBe(29);
    expect(result[1].end_page).toBe(50);
  });

  it("computes end pages for nested items", () => {
    const nodes: TocNodeInput[] = [
      { parent_id: null, title: "Ch 1", level: 0, order_index: 1, start_page: 10, end_page: null },
      { parent_id: "toc_1", title: "1.1", level: 1, order_index: 2, start_page: 12, end_page: null },
      { parent_id: "toc_1", title: "1.2", level: 1, order_index: 3, start_page: 20, end_page: null },
      { parent_id: null, title: "Ch 2", level: 0, order_index: 4, start_page: 30, end_page: null },
    ];
    const result = computeEndPages(nodes, 50);
    expect(result[0].end_page).toBe(29); // Ch 1: 10-29
    expect(result[1].end_page).toBe(19); // 1.1: 12-19
    expect(result[2].end_page).toBe(29); // 1.2: 20-29
    expect(result[3].end_page).toBe(50); // Ch 2: 30-50
  });

  it("handles single node", () => {
    const nodes: TocNodeInput[] = [
      { parent_id: null, title: "Only Chapter", level: 0, order_index: 1, start_page: 1, end_page: null },
    ];
    const result = computeEndPages(nodes, 100);
    expect(result[0].end_page).toBe(100);
  });

  it("handles empty list", () => {
    expect(computeEndPages([], 50)).toEqual([]);
  });
});
