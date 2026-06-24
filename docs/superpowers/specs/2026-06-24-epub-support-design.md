# EPUB Format Support

## Overview

Add EPUB ebook support to RustyBooks alongside the existing PDF reader. EPUBs are ZIP archives containing XHTML/CSS/images — fundamentally different from PDF's fixed-layout pages. The design adds a `document_type` discriminator to route between `PdfViewer` and a new `EpubViewer`.

## Architecture

```
document_type: 'pdf' | 'epub' field on Document

CenterViewer
  ├── PdfViewer  (existing, untouched)
  └── EpubViewer (new, features/epub/EpubViewer.tsx using epubjs)
```

No shared viewer abstraction — just a branch on `document_type`. The existing PDF pipeline is unchanged.

## Data Model

**documents table** — add `document_type TEXT NOT NULL DEFAULT 'pdf'`:
- Existing PDF rows get `'pdf'` (default)
- New EPUB rows get `'epub'`

**Rust `Document` struct** — add `document_type: String`
**TypeScript `Document` interface** — add `document_type: 'pdf' | 'epub'`

**pages table** — reused for EPUB. Each XHTML file in the EPUB spine becomes a "page" (chapter index, 1-based). The `text` column holds plain text stripped of HTML. The AI context builder reads from this same table regardless of format.

## Backend

### Command Changes
- `import_pdf` → `import_document` (detects type by file extension `.pdf`/`.epub`, same logic otherwise)
- `read_document_pdf` → `read_document_bytes` (reads raw bytes from disk, no format dependency)
- Both old names are removed (they're IPC-internal, not public API)

### New Module: `src-tauri/src/epub/`
Uses the `epub` crate for server-side EPUB parsing.

**`extractor.rs`** — Extract chapter text from EPUB:
1. Open the ZIP, parse `META-INF/container.xml` → locate OPF
2. Parse OPF for spine items (chapter XHTML files)
3. For each spine item, read the XHTML, strip HTML tags to plain text
4. Return `Vec<(chapter_index, title, text)>`

**`cover.rs`** — Extract cover image:
1. Find cover in OPF metadata (`cover` meta or `cover-image` property)
2. Read image bytes from the ZIP
3. Return `Vec<u8>` (or null if no cover)

### New IPC Command: `extract_epub_content`
Called after import. Runs asynchronously:
1. Calls the extractor to get chapter text
2. Inserts each chapter into `pages` table (with `text_status = 'ready'`)
3. Extracts TOC from EPUB navigation (NAV XHTML or NCX)
4. Inserts TOC nodes into `toc_nodes` table
5. Extracts cover image, stores for later retrieval

### New IPC Command: `get_document_cover`
Returns cover image bytes for a document. For PDFs, this falls back to the existing pdfjs page-1 rendering. For EPUBs, returns the cached cover image.

### Library Scanning
- `library.rs` folder scan: accept both `.pdf` and `.epub` extensions
- File watcher: watch for both extensions
- `handleOpenPdf` → `handleOpenDocument` (renamed, accepts both)

### Context Builder Updates
- `context_builder.rs` formats text as `[ch.{n}]\n{text}` for EPUB (instead of `[p.{n}]`)
- Citations become character-offset based: `[pos:12345]` → mapped to approximate scroll position
- Prompt templates gain EPUB variants

## Frontend

### EpubViewer (`src/features/epub/EpubViewer.tsx`)

Uses `epubjs` library in scrolled-doc mode for continuous scrolling.

**Mount flow:**
1. `invoke('read_document_bytes', { documentId })` → `Uint8Array`
2. `epubjs().open(byteArray, 'binary')` → `Book`
3. Create `Rendition` with `{ flow: 'scrolled-doc', width: '100%', height: '100%' }`
4. Attach to container div ref
5. Display first chapter

**Lifecycle:**
- `rendition.on('relocated', location)` → update reading position (scroll percentage, 0-100)
- Position saved to `last_page` via existing `update_last_page` command (0-100 scale)
- On re-open: `rendition.display()` with position restored from `last_page`

**Zoom:** Change `font-size` CSS property on the rendition container (or epubjs's `theme` API). No canvas scaling.

**TOC:** Extract from `book.navigation` → format for `TocSidebar` integration

**Search:** `rendition.annotations()` or custom text search over extracted text

**Keyboard shortcuts:** Same arrow/page keys as PDF view.

**Not needed (unlike PDF):**
- No canvas rendering — epubjs renders DOM-based HTML
- No virtual scroll — epubjs manages continuous scroll
- No PdfTextLayer — text selection is native HTML behavior
- No double-buffered zoom — font-size adjust is instant

### Book Covers
- PDFs: existing pdfjs page-1 canvas rendering (no change)
- EPUBs: `get_document_cover` IPC → render as `<img>` in `BookCard`
- Fallback: generic book icon when no cover available

### File Dialog
```typescript
filters: [{ name: "Documents", extensions: ["pdf", "epub"] }]
```

### Text Search
- PDFs: existing pdfjs-based search (no change)
- EPUBs: iterate chapter text from `pages` table via existing `search_pages_text` IPC, or use epubjs DOM search

## Dependencies

| Layer | Dependency | Purpose |
|-------|-----------|---------|
| Frontend | `epubjs` ^0.3.x | EPUB rendering, navigation, location tracking |
| Backend | `epub` crate | EPUB parsing, text/cover extraction in Rust |

## File Changes

**Modified:**
- `src-tauri/Cargo.toml` — +epub crate
- `src-tauri/src/db/migrations.rs` — +document_type column
- `src-tauri/src/db/models.rs` — +document_type field
- `src-tauri/src/commands/documents.rs` — generalize import/read
- `src-tauri/src/commands/library.rs` — accept .epub
- `src-tauri/src/commands/mod.rs` — +commands/epub
- `src-tauri/src/lib.rs` — register new commands
- `src-tauri/src/ai/context_builder.rs` — EPUB text formatting
- `src/stores/documentStore.ts` — +document_type, dialog filter
- `src/components/CenterViewer.tsx` — route to EpubViewer
- `package.json` — +epubjs

**New:**
- `src-tauri/src/epub/mod.rs`
- `src-tauri/src/epub/extractor.rs`
- `src-tauri/src/epub/cover.rs`
- `src-tauri/src/commands/epub.rs`
- `src/features/epub/EpubViewer.tsx`

## Verification

1. `npm test` — existing tests pass (no regressions)
2. `cargo build` — new Rust code compiles
3. Open a `.pdf` — existing reader works exactly as before
4. Open a `.epub` — book renders in scrolling mode, chapters display correctly
5. Navigate between chapters — TOC updates, reading position persists
6. AI features work with EPUB text (explain selection, summarize)
7. Library view shows EPUB covers correctly
8. Folder scan imports both formats
9. Search works in EPUB content
