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

  it("computes end pages with deep nesting in DFS order", () => {
    const nodes: TocNodeInput[] = [
      { parent_id: null, title: "Ch 1", level: 0, order_index: 1, start_page: 1, end_page: null },
      { parent_id: "toc_1", title: "1.1", level: 1, order_index: 2, start_page: 2, end_page: null },
      { parent_id: "toc_2", title: "1.1.1", level: 2, order_index: 3, start_page: 3, end_page: null },
      { parent_id: "toc_2", title: "1.1.2", level: 2, order_index: 4, start_page: 5, end_page: null },
      { parent_id: "toc_1", title: "1.2", level: 1, order_index: 5, start_page: 7, end_page: null },
      { parent_id: null, title: "Ch 2", level: 0, order_index: 6, start_page: 10, end_page: null },
    ];
    const result = computeEndPages(nodes, 20);
    expect(result[0].end_page).toBe(9);   // Ch 1: 1-9   (next level-0 starts at 10)
    expect(result[1].end_page).toBe(6);   // 1.1: 2-6   (next level≤1 is 1.2 at 7)
    expect(result[2].end_page).toBe(4);   // 1.1.1: 3-4 (next level≤2 is 1.1.2 at 5)
    expect(result[3].end_page).toBe(6);   // 1.1.2: 5-6 (next level≤2 is 1.2 at 7)
    expect(result[4].end_page).toBe(9);   // 1.2: 7-9   (next level≤1 is Ch 2 at 10)
    expect(result[5].end_page).toBe(20);  // Ch 2: 10-20
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
