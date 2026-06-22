import { describe, expect, it } from "vitest";
import { getHighlightColors, type TextSpan } from "../src/features/pdf/PdfTextLayer";

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
