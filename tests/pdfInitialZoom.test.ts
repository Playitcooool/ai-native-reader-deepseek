import { describe, expect, it } from "vitest";
import { computeInitialPdfZoom } from "../src/features/pdf/pdfInitialZoom";

describe("computeInitialPdfZoom", () => {
  it("fits the page width with a small gutter", () => {
    expect(computeInitialPdfZoom(1048, 1000)).toBe(1);
  });

  it("keeps first-open zoom readable on narrow and wide screens", () => {
    expect(computeInitialPdfZoom(320, 1000)).toBe(0.5);
    expect(computeInitialPdfZoom(2400, 1000)).toBe(1.75);
  });
});
