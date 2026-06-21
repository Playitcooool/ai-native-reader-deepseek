import { describe, it, expect } from "vitest";
import { parseCitations } from "../src/features/citations/citationParser";

describe("parseCitations", () => {
  it("parses [p.12]", () => {
    expect(parseCitations("See [p.12] for details.")).toEqual([
      { pageNumber: 12, match: "[p.12]" },
    ]);
  });

  it("parses [p. 12] with space", () => {
    expect(parseCitations("See [p. 12].")).toEqual([
      { pageNumber: 12, match: "[p. 12]" },
    ]);
  });

  it("parses [p 12] without dot", () => {
    expect(parseCitations("See [p 12].")).toEqual([
      { pageNumber: 12, match: "[p 12]" },
    ]);
  });

  it("parses multiple citations", () => {
    const result = parseCitations("See [p.1], [p.2], and [p.10].");
    expect(result).toHaveLength(3);
    expect(result[0].pageNumber).toBe(1);
    expect(result[1].pageNumber).toBe(2);
    expect(result[2].pageNumber).toBe(10);
  });

  it("parses case-insensitive", () => {
    expect(parseCitations("See [P.12] or [P 13].")).toHaveLength(2);
  });

  it("returns empty array for text without citations", () => {
    expect(parseCitations("No citations here.")).toEqual([]);
  });

  it("parses citations with larger page numbers", () => {
    expect(parseCitations("[p.1234]")).toEqual([
      { pageNumber: 1234, match: "[p.1234]" },
    ]);
  });
});
