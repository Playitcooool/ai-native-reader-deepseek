import { describe, expect, it } from "vitest";
import { documentDisplayTitle } from "../src/stores/documentStore";

describe("documentDisplayTitle", () => {
  it("falls back when the stored title is blank", () => {
    expect(documentDisplayTitle({
      title: "   ",
      original_filename: "book.pdf",
      file_path: "/tmp/book.pdf",
    })).toBe("book.pdf");
  });
});
