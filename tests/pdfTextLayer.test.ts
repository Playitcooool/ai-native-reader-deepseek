import { describe, expect, it } from "vitest";
import { buildTextSpan, getHighlightColors, type TextSpan } from "../src/features/pdf/PdfTextLayer";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

const span = (text: string): TextSpan => ({
  text,
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  fontSize: 1,
});

describe("getHighlightColors", () => {
  it("matches highlights across text spans and whitespace", () => {
    expect(
      getHighlightColors(
        [span("The "), span("quick"), span(" brown"), span(" fox")],
        [{ selected_text: "quick brown", color: "#fde047" }],
      ),
    ).toEqual([undefined, "rgba(253, 224, 71, 0.35)", "rgba(253, 224, 71, 0.35)", undefined]);
  });

  it("uses anchor context when selected text repeats", () => {
    expect(
      getHighlightColors(
        [span("alpha "), span("term "), span("beta "), span("term"), span(" gamma")],
        [{ selected_text: "term", color: "#86efac", anchor_json: JSON.stringify({ prefix: "beta ", suffix: " gamma" }) }],
      ),
    ).toEqual([undefined, undefined, undefined, "rgba(134, 239, 172, 0.35)", undefined]);
  });
});

describe("buildTextSpan", () => {
  it("uses the viewport transform for PDF text coordinates", () => {
    const item = {
      str: "Text",
      width: 40,
      height: 10,
      transform: [10, 0, 0, 10, 20, 700],
    } as TextItem;

    expect(buildTextSpan(item, [1.5, 0, 0, -1.5, 0, 1200], 1.5)).toEqual({
      text: "Text",
      x: 30,
      y: 135,
      width: 60,
      height: 15,
      fontSize: 15,
    });
  });
});
