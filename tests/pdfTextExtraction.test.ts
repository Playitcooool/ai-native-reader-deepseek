import { describe, expect, it } from "vitest";
import { normalizeExtractedText } from "../src/features/pdf/pdfTextExtraction";

describe("normalizeExtractedText", () => {
  it("cleans common PDF line wrap artifacts", () => {
    expect(normalizeExtractedText("concentra-\ntion   inequality \nnext")).toBe("concentration inequality\nnext");
  });
});
