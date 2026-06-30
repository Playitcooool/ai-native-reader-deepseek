import { describe, expect, it } from "vitest";
import { chapterToPercent, percentToChapter } from "../src/features/epub/epubProgress";

describe("epub progress conversion", () => {
  it("converts chapter positions to saved percent", () => {
    expect(chapterToPercent(1, 5)).toBe(0);
    expect(chapterToPercent(3, 5)).toBe(50);
    expect(chapterToPercent(5, 5)).toBe(100);
  });

  it("restores percent to the nearest chapter", () => {
    expect(percentToChapter(0, 5)).toBe(1);
    expect(percentToChapter(50, 5)).toBe(3);
    expect(percentToChapter(100, 5)).toBe(5);
  });

  it("clamps invalid inputs", () => {
    expect(chapterToPercent(99, 5)).toBe(100);
    expect(percentToChapter(-20, 5)).toBe(1);
    expect(percentToChapter(120, 5)).toBe(5);
    expect(percentToChapter(80, 0)).toBe(1);
  });
});
