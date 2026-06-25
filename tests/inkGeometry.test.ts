import { describe, expect, it } from "vitest";
import {
  denormalizePoint,
  normalizePoint,
  strokeInsideLasso,
  type InkAnchor,
} from "../src/features/ink/inkGeometry";

describe("inkGeometry", () => {
  it("normalizes and denormalizes coordinates", () => {
    const size = { width: 200, height: 100 };
    const normalized = normalizePoint({ x: 50, y: 25 }, size);
    expect(normalized).toEqual({ x: 0.25, y: 0.25 });
    expect(denormalizePoint(normalized, size)).toEqual({ x: 50, y: 25 });
  });

  it("selects a stroke fully inside the lasso", () => {
    const stroke: InkAnchor = {
      version: 1,
      space: "pdf-page",
      width: 4,
      points: [{ x: 0.35, y: 0.5 }, { x: 0.65, y: 0.5 }],
    };

    expect(strokeInsideLasso(stroke, squareLasso(), { width: 200, height: 100 })).toBe(true);
  });

  it("does not select a stroke outside the lasso", () => {
    const stroke: InkAnchor = {
      version: 1,
      space: "pdf-page",
      width: 4,
      points: [{ x: 0.05, y: 0.5 }, { x: 0.2, y: 0.5 }],
    };

    expect(strokeInsideLasso(stroke, squareLasso(), { width: 200, height: 100 })).toBe(false);
  });

  it("does not select a stroke crossing the lasso boundary", () => {
    const stroke: InkAnchor = {
      version: 1,
      space: "pdf-page",
      width: 4,
      points: [{ x: 0.3, y: 0.6 }, { x: 0.7, y: 0.6 }],
    };

    expect(strokeInsideLasso(stroke, concaveLasso(), { width: 200, height: 100 })).toBe(false);
  });

  it("ignores too-short lasso paths", () => {
    const stroke: InkAnchor = {
      version: 1,
      space: "pdf-page",
      width: 4,
      points: [{ x: 0.35, y: 0.5 }, { x: 0.65, y: 0.5 }],
    };

    expect(strokeInsideLasso(stroke, [{ x: 50, y: 25 }, { x: 150, y: 75 }], { width: 200, height: 100 })).toBe(false);
  });
});

function squareLasso() {
  return [
    { x: 50, y: 25 },
    { x: 150, y: 25 },
    { x: 150, y: 75 },
    { x: 50, y: 75 },
  ];
}

function concaveLasso() {
  return [
    { x: 40, y: 20 },
    { x: 160, y: 20 },
    { x: 160, y: 80 },
    { x: 120, y: 80 },
    { x: 120, y: 40 },
    { x: 80, y: 40 },
    { x: 80, y: 80 },
    { x: 40, y: 80 },
  ];
}
