# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
npm run dev           # Vite dev server only (port 1420)
npm run tauri dev     # Full Tauri dev (Vite + native window)
npm run build         # TypeScript check + Vite build (frontend only — does NOT produce an app bundle)
npm run tauri:build   # Production Tauri build → double-clickable macOS .app in src-tauri/target/release/bundle/
npm test              # Vitest (all tests)
npm run tauri         # Tauri CLI passthrough
```

- Tests use Vitest, no jsdom: only pure-logic unit tests in `tests/` (citation parser, TOC tree computation).
- Rust backend needs Rust 1.75+, tested separately via `cargo build` in `src-tauri/`.

## Architecture Overview

Tauri v2 desktop app with a **React frontend** and a **Rust backend** communicating via Tauri IPC commands.

### Frontend (React 18 + TypeScript + Vite)

Three-panel layout hardcoded in `App.tsx`:
- **LeftSidebar**: tabbed panel (Recent docs / TOC tree / Notes / Settings)
- **CenterViewer**: empty state or `PdfViewer` (keyed on document ID to force remount)
- **AiSidebar**: AI chat, quick actions, page range input, message list

State management is 5 Zustand stores in `src/stores/` — no React context aside from `ToastProvider`:
- `documentStore` — documents list, current document, page/zoom/TOC state, `handleOpenPdf` (triggers native file dialog via Tauri plugin)
- `aiStore` — AI messages, session ID, `runWorkflow` (calls `run_ai_workflow` Tauri command), loading flag
- `notesStore` — annotations CRUD
- `readerStore` — selection state (text + anchor metadata)
- `settingsStore` — AI provider settings

Feature modules in `src/features/`:
- `pdf/` — `PageView` (double-buffered canvas render with cross-fade zoom), `PdfTextLayer` (positioned spans for text selection), `SelectionMenu` (floating Explain/Highlight/Note toolbar), `PageExtractionQueue` (priority-based async text extraction that never blocks reading), `useVisibleRange` (virtual scroll with binary-search page detection, RAF-throttled)
- `toc/` — `tocTree.ts` (extracts PDF outline → flattens to DFS list → computes end pages from next-sibling/page-start), `TocSidebar` (renders nested buttons with active-page highlighting)
- `citations/` — `citationParser` (regex `[p.X]` → `CitationRef[]`)

### Backend (Rust, Tauri v2 commands)

Entry point at `src-tauri/src/lib.rs` — sets up native menu (File > Open PDF with Cmd+O), initializes SQLite database in app data dir, registers all command handlers.

Commands organized by domain in `src-tauri/src/commands/`:
- `documents.rs` — import PDF, list/get/delete, read file bytes, update page/zoom
- `pages.rs` — save/get page text, mark extraction failures
- `toc.rs` — save/get TOC tree, find TOC node for page
- `notes.rs` — annotation CRUD
- `settings.rs` — provider settings CRUD, provider connection test
- `ai.rs` — session management, `run_ai_workflow` (the central AI pipeline: resolve session → build context → build prompts → call provider → save messages)

AI module (`src-tauri/src/ai/`):
- `provider.rs` — OpenAI-compatible `/chat/completions` HTTP client (reqwest, 60s timeout)
- `context_builder.rs` — gathers hard evidence (selected text, page text, nearby pages, TOC breadcrumb) and soft memory (recent turns, session summary) up to 20K chars
- `prompts.rs` — 4 prompt templates (explain selection, summarize page, summarize range, chapter Q&A)

Database in `src-tauri/src/db/`:
- `migrations.rs` — 10 tables: `documents`, `pages`, `toc_nodes`, `annotations`, `ai_sessions`, `ai_messages`, `reading_states`, `ai_answer_citations`, `learning_memories`, `provider_settings`
- `models.rs` — Rust structs matching table rows

### Data Flow

1. **Open PDF**: Native file dialog → `import_pdf` command (computes SHA256, inserts document row) → frontend sets as `currentDocument` → `PdfViewer` loads via `read_file_bytes` + PDF.js → extracts TOC via `pdf.getOutline()` → saves to DB
2. **Page text extraction**: `PageExtractionQueue` runs after PDF load — priority 0 (current) → 1 (adjacent) → 2 (nearby) → 4 (rest). Each page saved via `save_page_text` command. Yields to UI thread via `setTimeout(0)` between pages.
3. **AI workflow**: `runWorkflow` in aiStore → `run_ai_workflow` command → context_builder reads DB for page text, TOC, session history → `provider.chat_completion` to OpenAI-compatible endpoint → saves user + assistant messages → returns markdown + context snapshot
4. **Zoom**: CSS scale for instant feedback → background canvas renders at new zoom → cross-fade → canvas roles swap
5. **Citation jump**: AI response `[p.X]` markers rendered as clickable links → `setCurrentPage(X)` → programmatic scroll

## Key Patterns

- All IPC calls use `invoke()` from `@tauri-apps/api/core` — no IPC wrapper layer, direct calls in components/stores.
- The `app-layout` CSS uses `resize: horizontal` on sidebars for draggable resizing.
- PDF rendering is virtual-scrolled: `useVisibleRange` computes which pages to render based on scroll position + binary search through cumulative offsets. Only visible pages + buffer mount `PageView` components.
- `PdfViewer` is keyed on `documentId` (`key={currentDocument.id}` in `CenterViewer`) so React unmounts/remounts on document switch.
- No React Router — single-page layout with Zustand-driven tab switching.
- Theme is stored in `localStorage` (`reader-theme` key) and toggled via a sync `<script>` in `index.html` to prevent flash. CSS variables on `[data-theme="dark"]` in `index.css`.
- PDF text search in `PdfViewer` iterates all pages via pdfjs `getTextContent()`, yielding every 3 pages via `setTimeout(0)` to keep UI responsive for long PDFs. Search is cancellable via ref flag.
- Effect ordering in `PdfViewer` matters: the programmatic scroll effect MUST be declared before the page detection effect. React fires effects in declaration order, so `progScrollRef` must be set `true` before the page detection reads scroll position — otherwise it schedules a page update from the stale scrollTop, causing oscillation.
- Ponytail mode: this codebase prefers minimal dependencies and YAGNI. No extra abstraction layers.
