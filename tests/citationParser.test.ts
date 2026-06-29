import { describe, it, expect } from "vitest";
import { linkCitationMarkdown, parseCitations } from "../src/features/citations/citationParser";

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

describe("linkCitationMarkdown", () => {
  it("links [p.12], [p 12], and multiple citations", () => {
    expect(linkCitationMarkdown("See [p.12] and [p 13].")).toBe(
      "See [p.12](ai-page://12) and [p 13](ai-page://13).",
    );
  });

  it("ignores citations in fenced code blocks", () => {
    expect(linkCitationMarkdown("Before [p.1]\n```\n[p.2]\n```\nAfter [p.3]")).toBe(
      "Before [p.1](ai-page://1)\n```\n[p.2]\n```\nAfter [p.3](ai-page://3)",
    );
  });

  it("ignores citations in inline code and math", () => {
    expect(linkCitationMarkdown("Use `[p.2]` and $[p.3]$ but cite [p.4].")).toBe(
      "Use `[p.2]` and $[p.3]$ but cite [p.4](ai-page://4).",
    );
  });

  it("ignores citations in block math", () => {
    expect(linkCitationMarkdown("$$\n[p.5]\n$$\nSee [p.6]")).toBe(
      "$$\n[p.5]\n$$\nSee [p.6](ai-page://6)",
    );
  });
});
