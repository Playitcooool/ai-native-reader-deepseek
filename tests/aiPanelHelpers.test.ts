import { describe, expect, it } from "vitest";
import { draftFromSelection, shouldFollowScroll } from "../src/features/ai/aiPanelHelpers";

describe("shouldFollowScroll", () => {
  it("follows when near the bottom", () => {
    expect(shouldFollowScroll(925, 100, 1000)).toBe(true);
  });

  it("does not follow when scrolled away", () => {
    expect(shouldFollowScroll(700, 100, 1000)).toBe(false);
  });
});

describe("draftFromSelection", () => {
  it("creates the selection draft", () => {
    expect(draftFromSelection("  quoted text  ")).toBe("About this selection:\n\nquoted text");
  });
});
