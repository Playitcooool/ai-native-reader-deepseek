# AI-Native PDF Reader — Detailed Design Document for Coding Agent

Document Metadata

```text
Version: v0.5
Date: 2026-06-20
Author: Wei Zhang + ChatGPT design assistant
Status: Agent-ready implementation revision
Scope: Lean/Fast/Accurate MVP + LLM Memory Management + Implementation Clarifications + First-Day Setup Fixes
```

Changelog

```text
v0.5 — 2026-06-20
- Added missing command input types: UpdateReadingStateInput, UpsertLearningMemoryInput, CreateAnnotationInput, and paginated GetAnnotationsInput.
- Specified selectedTextHash computation, canonical session scope serialization, ContextPack mode/scope precedence, and compact_session failure behavior.
- Added PDF.js worker setup requirements for Tauri + Vite and CSP worker guidance.
- Clarified native outline destination resolution, keyboard shortcut fallback behavior, get_annotations pagination, and Phase 8 citation plain-text limitation.
- Cleaned Table of Contents numbering and marked P1/P2 stub files in the proposed structure.

v0.4 — 2026-06-20
- Made ContextPack the only canonical AI context type; removed BuiltContext ambiguity.
- Added missing command/input/result types.
- Renumbered implementation phases into a strict Phase 0–10 sequence.
- Added explicit session lifecycle, scope_json schema, recent_pages_json schema, file relocation flow, file_sha256 computation rule, keyboard shortcuts, theming, and PDF text extraction caveats.
- Clarified token-estimation policy, provider enum scope, citation parsing fallback, provider streaming decision, and document pagination.

v0.3 — 2026-06-20
- Added LLM Memory Management: document memory, reading state, session memory, learning memory, citation memory.

v0.2 — 2026-06-20
- Revised design for light, fast, accurate MVP constraints.

v0.1 — 2026-06-20
- Initial detailed product and engineering design.
```

## Table of Contents

- [0. Executive Summary](#0-executive-summary)
- [0.1 Non-Negotiable Product Constraints](#01-non-negotiable-product-constraints-light-fast-accurate)
- [1. Product Positioning](#1-product-positioning)
- [2. Target Users and Core Use Cases](#2-target-users-and-core-use-cases)
- [3. Feature Priorities](#3-feature-priorities)
- [4. Recommended Tech Stack](#4-recommended-tech-stack)
- [5. High-Level Architecture](#5-high-level-architecture)
- [6. Data Model](#6-data-model)
- [7. TOC Extraction Design](#7-toc-extraction-design)
- [8. PDF Page Text Extraction](#8-pdf-page-text-extraction)
- [9. Reader UI Design](#9-reader-ui-design)
- [10. Context Builder](#10-context-builder)
- [11. AI Workflows](#11-ai-workflows)
- [12. Citation and Jump-Back Design](#12-citation-and-jump-back-design)
- [13. Notes and Annotations](#13-notes-and-annotations)
- [14. Tauri Commands / API Surface](#14-tauri-commands--api-surface)
- [15. Frontend State Management](#15-frontend-state-management)
- [16. Implementation Plan for Coding Agent](#16-implementation-plan-for-coding-agent)
- [17. Error Handling Requirements](#17-error-handling-requirements)
- [18. Performance Requirements](#18-performance-requirements)
- [19. Security and Privacy](#19-security-and-privacy)
- [20. Testing Plan](#20-testing-plan)
- [21. Suggested UI Copy](#21-suggested-ui-copy)
- [22. Future Extension Design](#22-future-extension-design)
- [23. Coding Agent Rules](#23-coding-agent-rules)
- [24. Definition of Done for MVP](#24-definition-of-done-for-mvp)
- [25. Minimal Vertical Slice](#25-minimal-vertical-slice)
- [26. Final Product Principle](#26-final-product-principle)

## 0. Executive Summary

Build a **local-first AI-native PDF reader**, not a generic “PDF chatbot”. The core value is not to beat ChatGPT at raw document understanding. The core value is to make AI aware of the user's **reading state**: current PDF, current page, current TOC node, selected text/region, nearby pages, saved notes, and previous interactions.

The product should focus on this loop:

```text
Open PDF → Extract TOC → Read page → Select text/region → AI explains with local context → Save answer as note → Click citation to return to original page/selection
```

The first version should be sharply scoped. Do **not** build a Zotero clone, Obsidian clone, browser extension, full OCR pipeline, or multi-document research agent in the MVP.

Primary MVP goal:

> A user reading a PDF can select text or a page range and get high-quality AI explanations/summaries grounded in the current page, nearby pages, and TOC context, with citations that jump back to the PDF.


## 0.1 Non-Negotiable Product Constraints: Light, Fast, Accurate

The software must be designed around three hard constraints:

```text
1. Light: minimal dependencies, local-first storage, no heavyweight background services in MVP.
2. Fast: open PDFs immediately, parse progressively, never block reading on full-document processing.
3. Accurate: prefer scoped context, page citations, TOC/page anchors, and explicit uncertainty over broad AI guesses.
```

These constraints override feature ambition. If a feature makes the app heavier, slower, or less reliable, it must be delayed unless it directly improves the core reading loop.

### 0.1.1 Light

MVP should avoid:

```text
- Python service
- embedding database
- full OCR pipeline
- background model server management
- browser extensions
- complex library manager
- cloud sync
- multi-document agents
- full note workspace
```

MVP should use:

```text
- Tauri + React + TypeScript
- PDF.js in frontend
- SQLite in Rust backend
- OpenAI-compatible HTTP adapter
- page text cache
- native PDF TOC extraction
```

The app should behave like a reader first and an AI system second.

### 0.1.2 Fast

The app must not wait for whole-document processing before becoming usable.

Opening flow:

```text
Open PDF
→ render first/current page immediately
→ extract native outline quickly
→ extract current page text
→ extract nearby pages
→ background extract remaining pages at low priority
```

AI flow:

```text
User action
→ build small context from selection/current page/TOC node
→ call AI
→ show answer
```

Do not run expensive preprocessing unless the user asks for it.

### 0.1.3 Accurate

Accuracy comes from correct context selection and traceability, not from sending more text.

Rules:

```text
- Never send the full PDF by default.
- Always include page numbers in evidence blocks.
- Always bind notes and AI answers back to source page/scope.
- Prefer current page + selected text + TOC path over broad document context.
- If evidence is insufficient, the assistant must say so.
- Citation jump-back is required for all page citations.
```

The app should optimize for reliable local explanations, not impressive whole-book summaries.

---

## 1. Product Positioning

### 1.1 What This Product Is

An AI-enhanced PDF reader that:

1. Opens local PDF files.
2. Extracts native PDF outline/TOC when available.
3. Displays a left-side TOC tree.
4. Tracks current page, current section, and selected text.
5. Builds the right context automatically for AI.
6. Sends only the needed page/selection/range context to an AI provider.
7. Returns answers with page citations.
8. Saves AI answers and user notes back to the PDF location.
9. Supports persistent reading state across sessions.

### 1.2 What This Product Is Not

This is **not**:

1. A general-purpose ChatGPT replacement.
2. A full paper management system like Zotero.
3. A full Markdown knowledge base like Obsidian.
4. A social/collaborative reading platform.
5. A browser-based PDF capture extension.
6. A full OCR + layout reconstruction system in the first version.
7. A full multi-PDF literature review agent in the first version.
8. A complete textbook learning system in the first version.

### 1.3 Main Differentiation from ChatGPT Web

ChatGPT can read a PDF if the user uploads it, but it is not a dedicated reading environment. This reader wins by providing:

1. One-click explain on selected text.
2. Automatic current-page and nearby-page context.
3. Automatic current-section context from TOC.
4. Citation jump-back to PDF page/selection.
5. Persistent notes and AI answers attached to source locations.
6. Reading progress, recent PDFs, and last-opened page.
7. Local-first storage and optional local model support.

---

## 2. Target Users and Core Use Cases

### 2.1 Target Users

Primary users:

1. Students reading textbooks and papers.
2. Researchers reading PDFs intensively.
3. Developers/engineers reading technical papers, specifications, and books.
4. Users who frequently ask AI to explain small sections of long documents.

### 2.2 Core Use Cases

#### Use Case A: Explain Selected Text

User selects a paragraph and clicks “Explain”.

System should:

1. Capture selected text and page number.
2. Find current TOC node if available.
3. Fetch current page text and nearby page text.
4. Send compact context to AI.
5. Return explanation with citations.
6. Allow saving answer as a note linked to the selection.

#### Use Case B: Summarize Current Page

User clicks “Summarize Page”.

System should:

1. Use current page text.
2. Optionally include previous/next page summaries or text.
3. Generate a concise summary and key points.
4. Cite page number.

#### Use Case C: Summarize Page Range

User enters `35-42` or drags a page range.

System should:

1. Fetch text for pages 35–42.
2. If text exceeds token budget, summarize per page first, then merge.
3. Return range summary, key concepts, and questions.
4. Store result as a range note.

#### Use Case D: Ask Current Section

User is inside Chapter/Section from TOC and asks a question.

System should:

1. Resolve current TOC node from current page.
2. Build context from current page, current TOC range, and top relevant text within that range.
3. Answer with section-scoped evidence.
4. If TOC does not exist, fallback to page window context.

#### Use Case E: Save AI Answer as Note

User receives AI answer and clicks “Save”.

System should:

1. Save note content.
2. Link note to document id, page number, selection range, optional bbox, and TOC node.
3. Show the note in the PDF sidebar later.

#### Use Case F: Continue Reading Later

User reopens the app.

System should:

1. Show recent PDFs.
2. Restore last-opened page and zoom.
3. Display existing highlights/notes.
4. Keep AI conversation history for the document.

---

## 3. Feature Priorities

### 3.1 P0 — MVP Must Have

Implement these first. P0 must stay lightweight: no OCR, no embeddings, no vector DB, no multi-document agent, no browser extension:

1. Open/import local PDF.
2. Render PDF pages.
3. Extract native PDF outline/TOC if present.
4. Display TOC tree and allow clicking TOC nodes to jump to pages.
5. Extract text per page.
6. Store document metadata, page text, TOC nodes, notes, and sessions locally.
7. Track current page.
8. Select text from PDF text layer.
9. Explain selected text with AI.
10. Summarize current page.
11. Summarize user-specified page range.
12. Save AI answer as a note linked to PDF location.
13. Show citations as clickable page links.
14. AI provider settings: OpenAI-compatible endpoint, API key, model name.
15. Fallback mode: if no TOC exists, still support page/selection/range AI.

### 3.2 P1 — Valuable After MVP

Implement after P0 is stable:

1. Printed TOC page detection.
2. Printed page number → PDF page number mapping.
3. Manual TOC editing.
4. Basic document keyword search.
5. Current-section Q&A.
6. Basic quiz generation for selected page range.
7. Export saved notes to Markdown.
8. Region selection screenshot for formulas/figures.
9. Local model presets for LM Studio / Ollama.
10. Citation verification pass.

### 3.3 P2 — Later

1. Embedding-based semantic search.
2. Hybrid RAG: keyword + embedding + TOC scope.
3. Reranker.
4. OCR for scanned PDFs.
5. Table extraction.
6. Formula recognition.
7. VLM-based figure explanation.
8. Multi-PDF search.
9. Flashcards and spaced repetition.
10. Full study mode with weak concept tracking.

### 3.4 Explicit Non-Goals for MVP

Do not implement in MVP:

1. Browser extension.
2. Safari/Chrome capture workflow.
3. Complex collection/tag/library manager.
4. BibTeX/citation manager.
5. Full Markdown workspace.
6. Handwriting/ink annotation.
7. Cloud sync.
8. Team collaboration.
9. Social sharing.
10. Full OCR pipeline.
11. Full multi-document research agent.
12. Full textbook learning path generation.

---

## 4. Recommended Tech Stack

### 4.1 Desktop App

Recommended:

```text
Tauri v2 + React + TypeScript
```

Reasoning:

1. Local-first desktop app.
2. Smaller footprint than Electron.
3. Good access to local filesystem through Rust backend.
4. Good fit if building from or near RustyReader-like architecture.

Alternative:

```text
Electron + React + TypeScript
```

Use Electron only if speed of development is more important than native footprint.

### 4.2 PDF Rendering and Text Layer

Use:

```text
PDF.js
```

Responsibilities:

1. Render PDF page canvas.
2. Render selectable text layer.
3. Extract page text via `getTextContent()`.
4. Read native outline via `getOutline()`.
5. Support page navigation, zoom, and search later.

PDF.js worker setup is a P0 first-day requirement. In a Tauri + Vite app, configure the worker before loading or rendering any PDF:

```ts
import { GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();
```

If the app uses a stricter Tauri v2 Content Security Policy, ensure worker loading is allowed. Depending on the bundler output, this may require `worker-src 'self' blob:` or the equivalent Tauri CSP configuration. Do not rely on PDF.js inline worker fallback in MVP.

### 4.3 Backend

Use Tauri Rust backend for:

1. File import.
2. Persistent document storage.
3. SQLite operations.
4. AI provider HTTP calls if preferred.
5. Secure-ish API key storage.
6. File path management.

Do not add a Python backend in MVP. Python PDF parsing/OCR can be introduced later only for advanced scanned-PDF support. The MVP should remain a single Tauri desktop app with no extra backend service to install or run.

### 4.4 Local Database

Use:

```text
SQLite
```

For MVP, SQLite is enough for:

1. Documents.
2. Pages.
3. TOC nodes.
4. Annotations.
5. AI sessions.
6. AI messages.
7. Notes.
8. Settings.

Use SQLite FTS5 in P1 for keyword search.

### 4.5 AI Provider Layer

Support OpenAI-compatible API first.

Provider config:

```text
base_url
api_key
model
provider_type: openai_compatible | lm_studio | ollama
```

MVP provider types are intentionally restricted to adapters that can use the same OpenAI-compatible chat-completions shape. `lm_studio` and `ollama` are presets over the same adapter, not separate protocol implementations. Native `anthropic`, `gemini`, and other non-OpenAI-compatible providers are P1/P2 stubs only and must not be added to the MVP enum.

For MVP, implement one generic OpenAI-compatible adapter:

```http
POST {base_url}/chat/completions
```

This makes it compatible with:

1. OpenAI API.
2. LM Studio local server.
3. Ollama OpenAI-compatible endpoint, if enabled.
4. Other OpenAI-compatible local servers.

---

## 5. High-Level Architecture

```text
Frontend React UI
  ├── PDF Viewer
  ├── TOC Sidebar
  ├── AI Sidebar
  ├── Notes/Annotations Panel
  └── Settings Panel

Tauri Rust Backend
  ├── Document Commands
  ├── Database Layer
  ├── AI Provider Adapter
  ├── Context Builder
  ├── Memory Manager
  ├── Session Compactor
  ├── Citation Store
  ├── Note/Annotation Commands
  └── File Storage Manager

Local Storage
  ├── SQLite database
  ├── Imported PDF files or file references
  ├── Page text cache
  ├── Reading state memory
  ├── AI session memory
  ├── Citation memory
  └── Optional page thumbnails later
```


### 5.0 Lean Architecture Rules

MVP should use a single desktop process plus SQLite. Avoid a multi-service architecture.

```text
Allowed in MVP:
- React UI
- PDF.js running in frontend
- Tauri Rust commands
- SQLite
- direct HTTP calls to OpenAI-compatible AI provider

Not allowed in MVP unless explicitly requested:
- separate Python backend
- local vector database
- OCR worker process
- model management daemon
- cloud account system
```

The frontend may extract text and outline through PDF.js, then pass structured results to the Rust backend for persistence. This is simpler and faster than duplicating PDF parsing in Rust or Python.

### 5.1 Core Modules

```text
src/
  app/
  components/
  features/
    pdf/
      PdfViewer.tsx
      PdfPage.tsx
      PdfTextLayer.tsx
      selection.ts
      pdfjs.ts
    toc/
      TocSidebar.tsx
      tocTree.ts
      tocRange.ts
    ai/
      AiSidebar.tsx
      AiMessageList.tsx
      AiComposer.tsx
      aiClient.ts
      contextPreview.tsx
      memoryPreview.tsx
    memory/
      memoryTypes.ts
      contextPackingPolicy.ts
      sessionSummary.ts       # P1 stub in Phase 0; implement in Phase 7
      learningMemory.ts       # P1/P2 stub only; create file, do not implement full logic in MVP
    notes/
      NotesPanel.tsx
      NoteCard.tsx
      noteAnchors.ts
    settings/
      ProviderSettings.tsx
  stores/
    documentStore.ts
    readerStore.ts
    aiStore.ts
    settingsStore.ts
    memoryStore.ts

src-tauri/src/
  main.rs
  commands/
    documents.rs
    pages.rs
    toc.rs
    notes.rs
    ai.rs
    settings.rs
  db/
    mod.rs
    migrations.rs
    models.rs
  ai/
    provider.rs
    openai_compatible.rs
    prompts.rs
    context_builder.rs
    memory_manager.rs
    session_compactor.rs
    citation_store.rs
    learning_memory.rs
  pdf/
    file_manager.rs
  util/
```

---

## 6. Data Model

### 6.1 Document

```sql
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  title TEXT,
  original_filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_sha256 TEXT,
  page_count INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT,
  last_page INTEGER DEFAULT 1,
  last_zoom REAL DEFAULT 1.0,
  parse_status TEXT DEFAULT 'pending',
  has_native_toc INTEGER DEFAULT 0
);
```

`file_sha256` must be computed in the Rust backend during `import_pdf`, not in the renderer. The frontend should only pass the selected path. The backend should read the file, compute SHA-256, store metadata, and return the created `Document`.

If the PDF is moved or renamed, `file_path` may become invalid. The app must support a re-link flow defined in section 17.1 and command `relink_document_file` in section 14.1.

### 6.2 Page

```sql
CREATE TABLE pages (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  text TEXT,
  text_status TEXT DEFAULT 'pending',
  char_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(document_id, page_number),
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);
```

### 6.3 TOC Node

```sql
CREATE TABLE toc_nodes (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  parent_id TEXT,
  title TEXT NOT NULL,
  level INTEGER NOT NULL,
  order_index INTEGER NOT NULL,
  start_page INTEGER NOT NULL,
  end_page INTEGER,
  source TEXT NOT NULL, -- native_outline | printed_toc | detected_heading | manual
  confidence REAL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY(parent_id) REFERENCES toc_nodes(id) ON DELETE CASCADE
);
```

### 6.4 Annotation

```sql
CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  toc_node_id TEXT,
  type TEXT NOT NULL, -- highlight | note | ai_note | region
  selected_text TEXT,
  note_text TEXT,
  color TEXT,
  anchor_json TEXT, -- selection offsets, text quote, bbox, etc.
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY(toc_node_id) REFERENCES toc_nodes(id) ON DELETE SET NULL
);
```

### 6.5 AI Session

```sql
CREATE TABLE ai_sessions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  title TEXT,
  scope_type TEXT NOT NULL, -- document | toc_node | page | range | selection
  scope_json TEXT NOT NULL,
  session_summary TEXT, -- compacted long-session memory
  last_compacted_message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);
```

`scope_json` must use this schema:

```ts
type AiSessionScope =
  | { scopeType: 'document' }
  | { scopeType: 'toc_node'; tocNodeId: string; startPage?: number; endPage?: number }
  | { scopeType: 'page'; pageNumber: number }
  | { scopeType: 'range'; startPage: number; endPage: number }
  | { scopeType: 'selection'; pageNumber: number; anchor?: SelectionAnchor; selectedTextHash?: string };
```

`selectedTextHash` must be deterministic across app restarts. Compute it in the frontend or backend with this exact rule before creating/reusing a selection-scoped session:

```ts
selectedTextHash = sha256(selectedText.trim().toLowerCase()).slice(0, 16);
```

Do not use truncated raw text as the session key. Do not include unstable whitespace, case, or UI-only selection metadata in the hash. If `selectedText` is empty, omit `selectedTextHash` and do not reuse a selection-scoped session.

The `scope_type` column must always duplicate `scope_json.scopeType` for efficient filtering. If they disagree, the row is invalid and should not be reused.

### 6.6 AI Message

```sql
CREATE TABLE ai_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL, -- user | assistant | system
  content TEXT NOT NULL,
  citations_json TEXT,
  context_snapshot_json TEXT, -- ContextPack JSON snapshot for assistant responses
  page_number INTEGER,
  selection_anchor_json TEXT,
  is_compacted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
);
```

### 6.7 Reading State Memory

Reading state is app-owned memory. It should allow the app to reopen a PDF exactly where the user left off and build AI context from the active reading location.

```sql
CREATE TABLE reading_states (
  document_id TEXT PRIMARY KEY,
  current_page_number INTEGER DEFAULT 1,
  current_toc_node_id TEXT,
  progress_ratio REAL DEFAULT 0,
  recent_pages_json TEXT, -- JSON array of recent page numbers, newest first, capped at 10
  last_selection_anchor_json TEXT,
  last_opened_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY(current_toc_node_id) REFERENCES toc_nodes(id) ON DELETE SET NULL
);
```

`recent_pages_json` schema:

```ts
type RecentPagesJson = number[]; // newest first, unique, capped at 10, 1-based page numbers
```

Update rule: when the current page changes, remove that page if already present, insert it at the front, and truncate to 10 pages.

### 6.8 AI Answer Citations

Do not rely only on `citations_json` inside messages. Store citations separately so old AI answers can always jump back to PDF locations.

```sql
CREATE TABLE ai_answer_citations (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  toc_node_id TEXT,
  quote TEXT,
  bbox_json TEXT,
  anchor_json TEXT,
  confidence REAL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(message_id) REFERENCES ai_messages(id) ON DELETE CASCADE,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY(toc_node_id) REFERENCES toc_nodes(id) ON DELETE SET NULL
);
```

### 6.9 Learning Memory, P1/P2

Learning memory is not required for the first vertical slice, but the schema should be reserved early because it is central to long-term differentiation from ChatGPT web.

```sql
CREATE TABLE learning_memories (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  concept TEXT NOT NULL,
  concept_normalized TEXT NOT NULL,
  status TEXT NOT NULL, -- unknown | confused | learning | understood | review_needed
  related_page_numbers_json TEXT,
  evidence_message_ids_json TEXT,
  confidence REAL DEFAULT 0.5,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(document_id, concept_normalized),
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);
```

`concept_normalized` must be computed on insert/update as `concept.trim().toLowerCase()`. This prevents separate rows for variants such as `markov chain` and `Markov Chain`.

MVP may create the table without actively using it. P1 can update it manually from saved notes. P2 can update it automatically from repeated user questions and quiz results.

### 6.10 Provider Settings

```sql
CREATE TABLE provider_settings (
  id TEXT PRIMARY KEY,
  provider_type TEXT NOT NULL,
  base_url TEXT,
  api_key TEXT,
  model TEXT NOT NULL,
  is_default INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

For production, API key should eventually be stored in OS keychain or encrypted local storage. Plain SQLite is acceptable only for early prototype if clearly labeled.

---

## 7. TOC Extraction Design

### 7.1 MVP TOC Source: Native PDF Outline

Use PDF.js:

```ts
const outline = await pdfDocument.getOutline();
```

Each outline item usually contains:

```ts
title
items
unsafeUrl / url / dest
```

Resolve destination to page number with null-safe handling. PDF.js outline items can contain `dest` as a named string, a direct destination array, `null`, or a URL-only navigation target. The implementation must not assume `item.dest` is always array-like.

```ts
async function resolveOutlinePageNumber(pdfDocument, item): Promise<number | null> {
  if (!item.dest) {
    // URL-only or non-navigable outline item. Keep the title only or skip as a TOC node.
    return null;
  }

  let dest = null;

  if (typeof item.dest === 'string') {
    dest = await pdfDocument.getDestination(item.dest);
  } else if (Array.isArray(item.dest)) {
    dest = item.dest;
  }

  if (!dest || !dest[0]) return null;

  const pageIndex = await pdfDocument.getPageIndex(dest[0]);
  return pageIndex + 1;
}
```

If a node has no resolvable page target but has children with page targets, keep it as a parent container. If neither it nor its descendants have page targets, skip it in MVP.

Store as `toc_nodes` with:

```text
source = native_outline
confidence = 1.0
```

For MVP, native PDF outline is treated as fully trusted navigation metadata. Confidence gradation is reserved for P1 printed-TOC and heading-detection recovery.

### 7.2 Computing TOC Node End Pages

After collecting nodes sorted by document order:

1. For each node, find the next node of same or higher level.
2. Current node `end_page = next_node.start_page - 1`.
3. If no next node, `end_page = document.page_count`.
4. For parent node, optionally set `end_page` to last descendant end page.

Example:

```text
Chapter 1 start 10
  1.1 start 12
  1.2 start 20
Chapter 2 start 30
```

Then:

```text
Chapter 1: 10–29
1.1: 12–19
1.2: 20–29
Chapter 2: 30–end
```

### 7.3 Fallback When No TOC Exists

MVP fallback:

1. Show “No native TOC found”.
2. Still support page-based AI.
3. Allow user to create manual section range later.

P1 fallback:

1. Detect printed TOC pages.
2. Parse TOC text.
3. Build printed page → PDF page mapping.
4. Allow user to confirm/edit guessed TOC.

### 7.4 Manual TOC Editing, P1

Allow user to:

1. Add section at current page.
2. Rename section.
3. Change level.
4. Change start/end page.
5. Delete section.
6. Reorder nodes.

Manual nodes should have:

```text
source = manual
confidence = 1.0
```

---

## 8. PDF Page Text Extraction

### 8.1 Text Extraction Strategy

For each page, extract text through PDF.js:

```ts
const page = await pdf.getPage(pageNumber);
const textContent = await page.getTextContent();
const rawItems = textContent.items;
```

MVP may use a simple text join, but it must preserve line breaks when possible:

```ts
const text = joinPdfTextItemsBasic(rawItems);
```

Minimum implementation:

```ts
function joinPdfTextItemsBasic(items: TextItem[]): string {
  // 1. Drop empty string items.
  // 2. For each item, read x = item.transform[4], y = item.transform[5].
  // 3. Group items by rounded Y, for example Math.round(y / 5) * 5.
  // 4. Sort line groups by descending Y so top-of-page text comes first.
  // 5. Within each line group, sort items by ascending X.
  // 6. Join items inside a line with a single space.
  // 7. Join line groups with '\n'.
  // 8. Return the resulting string.
  //
  // This is still imperfect for two-column PDFs, but it avoids the worst
  // item.str.join(' ') behavior. Full layout/reading-order recovery is P1.

  const nonEmpty = items.filter(item => item.str?.trim().length > 0);
  const groups = new Map<number, TextItem[]>();

  for (const item of nonEmpty) {
    const y = item.transform?.[5] ?? 0;
    const roundedY = Math.round(y / 5) * 5;
    const group = groups.get(roundedY) ?? [];
    group.push(item);
    groups.set(roundedY, group);
  }

  return Array.from(groups.entries())
    .sort(([yA], [yB]) => yB - yA)
    .map(([, lineItems]) =>
      lineItems
        .sort((a, b) => (a.transform?.[4] ?? 0) - (b.transform?.[4] ?? 0))
        .map(item => item.str.trim())
        .join(' ')
    )
    .join('\n');
}
```

Avoid this as the final implementation:

```ts
textContent.items.map(item => item.str).join(' ')
```

That naive join may interleave two-column academic papers and produce garbled text. Because two-column papers are a target use case, MVP should at least use position-aware line grouping. P1 should add more robust reading-order recovery for multi-column layouts.

Store the resulting text in `pages.text`.

### 8.2 Background Extraction

Do not block opening the PDF on full extraction.


Use a priority queue:

```text
Priority 0: current page
Priority 1: previous and next page
Priority 2: pages visible in viewport
Priority 3: TOC destination pages
Priority 4: remaining pages in background
```

Extraction should pause or slow down when the user is scrolling, zooming, or interacting with AI. The reader must stay responsive.

Flow:

```text
1. User opens PDF.
2. Render current page immediately.
3. Extract current page text.
4. Extract nearby pages.
5. Continue extracting remaining pages in background.
6. Update page text status.
```

### 8.3 Page Text Status

Use statuses:

```text
pending
extracting
ready
failed
```

If page text is unavailable when AI is called:

1. Extract it immediately.
2. If extraction fails, show user-friendly error.
3. For scanned pages, show “Text extraction failed. OCR support is planned.”

---

## 9. Reader UI Design

### 9.1 Layout

Use three-pane layout:

```text
┌──────────────────────┬──────────────────────────────┬──────────────────────┐
│ Left Sidebar          │ Center PDF Viewer             │ Right AI Sidebar     │
├──────────────────────┼──────────────────────────────┼──────────────────────┤
│ TOC                  │ PDF pages                     │ AI chat              │
│ Notes                │ Selection layer               │ Context chips        │
│ Recent files         │ Highlights                    │ Save note buttons    │
└──────────────────────┴──────────────────────────────┴──────────────────────┘
```

### 9.2 Left Sidebar

Tabs:

1. TOC.
2. Notes.
3. Recent PDFs.

MVP may implement only TOC + Notes.

### 9.3 Center PDF Viewer

Must support:

1. Page rendering.
2. Scroll navigation.
3. Current page detection.
4. Zoom in/out.
5. Text selection.
6. Clickable highlights/notes.
7. Citation jump from AI panel.

### 9.4 Right AI Sidebar

Components:

1. Context chips:
   - Current PDF.
   - Current page.
   - Current TOC node if available.
   - Selected text length.
   - Page range if active.
2. Quick actions:
   - Explain selection.
   - Translate selection.
   - Summarize page.
   - Summarize range.
   - Ask current section.
   - Generate questions.
3. Chat message list.
4. Save answer button.
5. Citation links.

### 9.5 Keyboard Shortcuts

MVP shortcuts:

| Shortcut | Action |
|---|---|
| `←` / `PageUp` | Previous page |
| `→` / `PageDown` | Next page |
| `+` / `=` | Zoom in |
| `-` | Zoom out |
| `0` | Reset zoom |
| `G` | Jump to page |
| `E` | Explain current selection |
| `S` | Summarize current page |
| `A` | Focus AI composer |
| `Esc` | Clear selection / close transient menu |
| `Cmd/Ctrl + O` | Open/import PDF |
| `Cmd/Ctrl + F` | Find in document, P1 if not in MVP |

Shortcuts must not trigger while the user is typing inside an input, textarea, or rich text field.

`E` fallback behavior: if there is no active selection, do not call the AI provider. Show a small toast: `Select text first, then press E to explain.` The AI composer should not be opened automatically because that changes the intended shortcut from scoped explanation to free-form chat.

### 9.6 Theming

MVP should support at least a readable light theme. Dark mode is P1 but the UI should be designed with theme tokens from the start:

```ts
type ThemeMode = 'system' | 'light' | 'dark';
```

Do not hard-code reader, sidebar, highlight, or AI message colors directly in components. Use CSS variables or a centralized theme token file so dark mode can be added without rewriting UI code.

---

## 10. Context Builder

The context builder is the most important product layer. It decides what to send to AI.


Accuracy policy:

```text
Small correct context > large vague context.
```

For most actions, the context builder should prefer:

```text
1. selected text, if any
2. current page text
3. current TOC breadcrumb
4. previous/next page text only if needed
5. current TOC node range only for section questions
```

It should avoid:

```text
- whole-document prompt stuffing
- automatic large range summarization
- embedding search before page/TOC context is stable
- hidden context expansion that the user cannot inspect
```

Add a context preview/debug panel for development so the coding agent can verify exactly what is being sent to AI.

### 10.1 Canonical ContextPack Type

`ContextPack` is the only canonical context object used by AI workflows. Do not introduce or use `BuiltContext`. Earlier drafts mentioned `BuiltContext`; it is deprecated and must not appear in implementation types, API responses, frontend stores, or context snapshots.

```ts
type SelectionAnchor = {
  type: 'text_quote' | 'text_position' | 'region';
  pageNumber: number;
  selectedText?: string;
  prefix?: string;
  suffix?: string;
  bbox?: [number, number, number, number];
  textLayerIndices?: [number, number];
};

type ContextItem = {
  id: string;
  kind:
    | 'selected_text'
    | 'page_text'
    | 'nearby_page'
    | 'range_text'
    | 'toc_breadcrumb'
    | 'session_recent_turn'
    | 'session_summary'
    | 'saved_note'
    | 'learning_memory';
  priority: number;
  text: string;
  pageNumber?: number;
  tocNodeId?: string;
  anchor?: SelectionAnchor;
  isHardEvidence: boolean;
};

type ContextPack = {
  documentId: string;
  sessionId?: string;
  mode: 'selection_explain' | 'page_summary' | 'range_summary' | 'chapter_qa' | 'find_in_doc';
  scope: AiSessionScope;
  hardEvidence: ContextItem[];
  softMemory: ContextItem[];
  citationTargets: Citation[];
  tokenEstimate: number;
  charEstimate: number;
  warnings: string[];
};
```

Rules:

1. All AI workflows return and persist `ContextPack` as `context_snapshot_json`.
2. `hardEvidence` contains PDF-grounded evidence only.
3. `softMemory` contains conversation/learning/note context only.
4. The development context preview must show `hardEvidence` and `softMemory` separately.
5. `ContextPack.tokenEstimate` must be conservative; see section 10.6.

`mode` and `scope.scopeType` serve different purposes and must not be treated as interchangeable:

```text
mode = the AI workflow being executed, such as selection_explain or page_summary.
scope.scopeType = the conversation/session reuse boundary, such as selection, page, range, toc_node, or document.
```

Precedence rule: `mode` controls prompt template and context-building behavior. `scope` controls session lookup and persistence. They may intentionally diverge in a small number of cases; for example, `mode = 'chapter_qa'` can use `scope.scopeType = 'toc_node'`, and `mode = 'page_summary'` can use `scope.scopeType = 'page'`. Invalid combinations should be rejected in development mode.

Allowed MVP combinations:

| mode | allowed scope.scopeType |
|---|---|
| `selection_explain` | `selection` |
| `page_summary` | `page` |
| `range_summary` | `range` |
| `chapter_qa` | `toc_node` or `page` fallback when no TOC exists |
| `find_in_doc` | `document` |

### 10.2 Selection Context

Input:

```ts
{
  documentId,
  pageNumber,
  selectedText,
  selectionAnchor
}
```

Context:

1. Selected text.
2. Current page text.
3. Previous page text, if available and small.
4. Next page text, if available and small.
5. TOC breadcrumb.
6. TOC node page range metadata.

Do not send the entire document.

### 10.3 Page Context

Input:

```ts
{
  documentId,
  pageNumber
}
```

Context:

1. Current page text.
2. TOC breadcrumb.
3. Optional previous/next page text if token budget allows.

### 10.4 Page Range Context

Input:

```ts
{
  documentId,
  startPage,
  endPage
}
```

If total text is below budget:

1. Send all page texts with page separators.

If total text is above budget:

1. Summarize each page or small page group.
2. Merge summaries.
3. Store intermediate summaries in message context snapshot.

### 10.5 Current Section Context

Input:

```ts
{
  documentId,
  currentPage,
  question
}
```

Flow:

1. Find deepest TOC node containing `currentPage`.
2. Fetch current page and nearby page text.
3. Fetch page texts inside current TOC node, but respect token budget.
4. If section is too large, prefer:
   - current page
   - pages around current page
   - first page of section
   - pages matching simple keyword query, P1
5. If no TOC node exists, fallback to page context.

### 10.6 Token Budget Policy

MVP uses character limits as a conservative token-budget proxy. This is intentionally approximate because different providers tokenize differently.

Initial default:

```text
max_input_chars_cloud = 20000
max_input_chars_local = 8000
token_estimate = ceil(char_count / 3)
```

Use `/ 3` instead of `/ 4` to avoid overfilling local or multilingual models. `ContextPack` must store both `charEstimate` and `tokenEstimate`. Later provider-specific tokenizers can replace this approximation.

Make this configurable later.

Context priority order:

1. User selection.
2. Current page.
3. TOC breadcrumb and metadata.
4. Nearby pages.
5. Current section pages.
6. Older session memory.

Never sacrifice selected text or current page for broader context.

### 10.7 LLM Memory Management

The app must treat the LLM as a stateless reasoning engine. Long-term memory belongs to the application, not to the model.

Core rule:

```text
LLM = stateless inference engine
App = memory manager and context router
```

The app should never assume that a provider remembers previous calls. Every AI call must receive a deliberately packed context built from persistent app memory.

#### 10.7.1 Memory Layers

The memory system has five layers:

```text
1. Document Memory
   - PDF pages
   - page text
   - native TOC / recovered TOC
   - page-to-TOC mapping
   - section summaries, P1

2. Reading State Memory
   - current page
   - current TOC node
   - recent pages
   - last selection
   - last opened time

3. Session Memory
   - recent user/assistant turns
   - compacted session summary
   - unresolved references such as "this formula" or "the previous definition"

4. User Learning Memory, P1/P2
   - concepts the user repeatedly asks about
   - weak concepts
   - saved explanations
   - review-needed concepts

5. Citation Memory
   - page citations from AI answers
   - selected text anchors
   - optional bbox anchors
   - jump-back targets
```

MVP must implement layers 1, 2, 3, and 5 in a lightweight way. Layer 4 can be a reserved schema plus minimal manual updates.

#### 10.7.2 Memory Priority

When packing context, use this priority order:

```text
Hard evidence, highest priority:
1. selected text
2. current page text
3. cited source pages
4. current TOC node and breadcrumb
5. nearby pages

Soft memory, lower priority:
6. recent conversation turns
7. session summary
8. saved notes relevant to current page/TOC node
9. learning memory / weak concepts
```

PDF evidence must always override memory. User learning memory can adapt explanation style, but must not be used as factual evidence for claims about the PDF.

Add this instruction to all AI prompts:

```text
Use PDF evidence as the source of truth. Use user/session memory only to maintain conversational continuity or adapt the explanation. If memory conflicts with PDF evidence, follow the PDF evidence. If the provided PDF evidence is insufficient, say so explicitly.
```

#### 10.7.3 Session Memory Packing

For each AI call, include:

```text
- last 4 to 6 recent user/assistant turns, if relevant
- compacted session summary, if available
- current user question
- current reading state
```

Do not include the full chat history by default.

Recommended defaults:

```ts
const SESSION_MEMORY_DEFAULTS = {
  maxRecentTurnsCloud: 6,
  maxRecentTurnsLocal: 3,
  compactAfterTurns: 10,
  maxSessionSummaryChars: 1800,
};
```

#### 10.7.4 Session Compaction

When a session becomes long, compact older turns into `ai_sessions.session_summary`.

Compaction input:

```text
old user/assistant messages
saved citations
current document title
current TOC node, if any
```

Compaction output should include:

```text
- what section/page the user was reading
- important explanations already given
- unresolved questions
- concepts the user struggled with
- saved notes or citations that matter
```

Example compacted summary:

```text
The user is reading Chapter 3 on Markov Decision Processes. They struggled with the distinction between return, value function, and Bellman equation. They saved the explanation for p.42 about expected return. Their current unresolved issue is why the expectation is conditioned on state s.
```

MVP can run compaction manually or lazily when opening a session. It must not block reading.

#### 10.7.5 ContextPack Usage

Use the canonical `ContextPack` type defined in section 10.1. Do not define a second context type in this section.

The development context preview must show two separate sections:

```text
Hard evidence sent to model
Soft memory sent to model
```

This separation is required to debug hallucinations and memory pollution.

#### 10.7.6 Memory Use by Workflow

Selection Explain:

```text
Required:
- selected text
- current page text
- TOC breadcrumb

Optional:
- previous/next page text
- recent 2–4 turns
- session summary if relevant
- weak concept memory, P2
```

Page Summary:

```text
Required:
- current page text
- page number
- TOC breadcrumb

Optional:
- previous/next page text
- no old conversation unless user asks a follow-up
```

Range Summary:

```text
Required:
- page-separated range text or page-group summaries

Do not include:
- old conversation, unless the user explicitly asks to connect it
```

Ask Current Section:

```text
Required:
- current page
- TOC node metadata
- relevant pages inside current TOC node
- recent turns for follow-up reference resolution

Optional:
- section summary, P1
- saved notes in the same TOC node
```

Find in Document:

```text
Required:
- query
- keyword search results, P1
- page snippets

Do not include:
- full document
- all notes
```

#### 10.7.7 Memory Pollution Rules

The app must prevent memory from making answers less accurate.

Rules:

```text
1. Soft memory cannot create factual claims about the PDF.
2. Soft memory can only influence tone, continuity, and pedagogy.
3. Every factual claim about document content should be tied to hard evidence.
4. If memory says one thing and current page evidence says another, follow current page evidence.
5. If no hard evidence exists, answer with uncertainty.
```

#### 10.7.8 MVP Memory Scope

P0 memory requirements:

```text
- reading_states table
- ai_sessions table with session_summary field
- ai_messages table with recent-turn retrieval
- ai_answer_citations table
- context snapshot saved per AI answer
- citation jump-back from old answers
```

P1 memory requirements:

```text
- automatic session compaction
- saved notes included when asking within same page/TOC node
- section summaries cached and reused
```

P2 memory requirements:

```text
- learning_memories updates
- weak concept tracking
- quiz/review integration
- semantic memory retrieval, only after lightweight MVP is stable
```

#### 10.7.9 Session Compaction Behavior

`compact_session` calls the configured AI provider. It may consume API credits or local model time, so it must only run from an explicit user action or a clearly visible lazy maintenance action. Do not run silent background compaction in MVP.

Failure behavior:

1. If no provider is configured, return a typed error and leave the session unchanged.
2. If the provider call fails, times out, or returns unusable output, leave all messages unmodified and keep `is_compacted = 0`.
3. Store no partial `session_summary` on failure.
4. Show a non-blocking UI error: `Could not compact this session. Your original messages were preserved.`
5. Mark the session as eligible for retry later, but do not retry automatically more than once per user action.
6. The app must never delete or hide old messages until a valid summary has been saved successfully.

Acceptance rule: compaction failure must not cause message loss, citation loss, or an unbounded silent loop of provider calls.

#### 10.7.10 Session Lifecycle

A session represents one AI conversation bound to a document and a scope.

Session creation/reuse rules for `get_or_create_ai_session`:

1. If `documentId` has no session for the requested `AiSessionScope`, create one.
2. If an existing non-archived session has the same `documentId`, `scope_type`, and canonicalized `scope_json`, reuse the most recently updated one.
3. For `page` scope, reuse the session for the exact page number.
4. For `range` scope, reuse only when `startPage` and `endPage` match exactly.
5. For `toc_node` scope, reuse only when `tocNodeId` matches.
6. For `selection` scope, reuse only when `pageNumber` and `selectedTextHash` match; otherwise create a new selection-scoped session.
7. For `document` scope, reuse the latest document-wide session.
8. When the user switches PDFs, preserve the active session id per document in frontend state and restore it when the user returns.
9. A user action named `New chat for this scope` must create a fresh session even if a reusable session exists.
10. A user action named `Continue previous chat` should reopen the last updated session for the current document, regardless of scope, but the context builder must still use the current reading state.

Canonicalization rule:

Use explicit per-variant stable strings instead of raw `JSON.stringify`, because object key order can vary if code constructs objects differently. Omit undefined values.

```ts
function canonicalizeScope(scope: AiSessionScope): string {
  switch (scope.scopeType) {
    case 'document':
      return 'document';
    case 'page':
      return `page:${scope.pageNumber}`;
    case 'range':
      return `range:${scope.startPage}-${scope.endPage}`;
    case 'toc_node':
      return `toc_node:${scope.tocNodeId}`;
    case 'selection':
      return `selection:${scope.pageNumber}:${scope.selectedTextHash ?? 'nohash'}`;
  }
}
```

The app must never merge sessions from different documents.

---

## 11. AI Workflows

### 11.1 Common AI Response Format

Ask the model to return Markdown plus citations.

MVP response format can be plain Markdown with explicit citations:

```markdown
Explanation...

References:
- p.12
- p.13
```

P1 should move to structured JSON:

```json
{
  "answer_md": "...",
  "citations": [
    {
      "page_number": 12,
      "evidence_chunk_id": "...",
      "quote": "short quote from source"
    }
  ]
}
```

### 11.2 Prompt: Explain Selection

System message:

```text
You are an AI reading assistant inside a PDF reader. Answer only using the provided PDF context. If the context is insufficient, say what is missing. Do not invent page numbers or claims. Explain clearly and teach the user.
```

User message template:

```text
Task: Explain the selected text.

Document: {{title}}
Current page: {{page_number}}
Current TOC path: {{toc_path}}

Selected text:
{{selected_text}}

PDF context:
{{evidence_blocks}}

Please provide:
1. A clear explanation.
2. Any important prerequisite concepts.
3. Why this passage matters in the local section.
4. Page references using [p.X].
```

### 11.3 Prompt: Summarize Page

```text
Task: Summarize the current PDF page.

Document: {{title}}
Page: {{page_number}}
Current TOC path: {{toc_path}}

Page text:
{{page_text}}

Return:
1. Main idea.
2. Key points.
3. Terms/concepts to remember.
4. One question the reader should be able to answer.
Use [p.X] references.
```

### 11.4 Prompt: Summarize Range

```text
Task: Summarize the selected page range.

Document: {{title}}
Pages: {{start_page}}–{{end_page}}
Current TOC path if applicable: {{toc_path}}

Page texts:
{{page_texts_with_separators}}

Return:
1. Short overview.
2. Detailed bullet summary.
3. Key concepts.
4. Potential confusions.
5. 3 review questions.
Use page references like [p.X].
```

### 11.5 Prompt: Ask Current Section

```text
Task: Answer the user's question using the current PDF section context.

Document: {{title}}
Current page: {{current_page}}
Current section: {{toc_title}}
Section page range: {{start_page}}–{{end_page}}

Question:
{{question}}

Evidence:
{{evidence_blocks}}

Rules:
- Use only the provided evidence.
- If evidence is insufficient, say so.
- Cite pages using [p.X].
- Keep the answer practical and explanatory.
```

---

## 12. Citation and Jump-Back Design

### 12.1 Citation Object

```ts
type Citation = {
  id: string;
  documentId: string;
  pageNumber: number;
  evidenceChunkId?: string;
  quote?: string;
  bbox?: [number, number, number, number];
  annotationId?: string;
};
```

### 12.2 Citation UI

In AI messages, render `[p.12]` as clickable buttons.

On click:

1. Navigate PDF viewer to page 12.
2. If bbox exists, scroll to bbox and flash highlight.
3. If quote exists but no bbox, search quote on page and highlight approximate match.
4. If neither bbox nor quote exists, simply navigate to page.

### 12.3 MVP Citation Extraction

MVP can parse page references from assistant response with an intentionally minimal fallback parser:

```regex
/\[p\.?\s*(\d+)\]/gi
```

This handles `[p.12]`, `[p. 12]`, and `[p 12]`. It still does not robustly handle every possible variant such as `[pp.12–14]`, `[page 12]`, or prose like `p. 12`. P1 must move to structured JSON response to avoid fragile parsing.

---

## 13. Notes and Annotations

### 13.1 Annotation Types

MVP:

1. Highlight.
2. User note.
3. AI note.

P1:

1. Region note for formula/figure.
2. Page range note.

### 13.2 Save AI Answer as Note

When user clicks “Save as Note”:

1. Create annotation of type `ai_note`.
2. Link to current scope:
   - selection → selected text + page + anchor.
   - page → page number.
   - range → start/end page in anchor_json.
   - TOC node → toc_node_id.
3. Store assistant answer in `note_text`.
4. Store citations in `anchor_json`.

### 13.3 Highlight Anchoring

MVP anchor strategy:

```json
{
  "type": "text_quote",
  "page_number": 12,
  "selected_text": "...",
  "prefix": "optional text before selection",
  "suffix": "optional text after selection"
}
```

P1 anchor strategy:

```json
{
  "type": "text_position",
  "page_number": 12,
  "selected_text": "...",
  "bbox": [x1, y1, x2, y2],
  "text_layer_indices": [start, end]
}
```

---

## 14. Tauri Commands / API Surface

### 14.1 Document Commands

```ts
import_pdf(filePath: string): Promise<Document>
compute_file_sha256(filePath: string): Promise<string>
relink_document_file(documentId: string, newFilePath: string): Promise<Document>
get_documents(input?: GetDocumentsInput): Promise<Document[]>
get_document(documentId: string): Promise<Document>
update_last_page(documentId: string, pageNumber: number): Promise<void>
delete_document(documentId: string): Promise<void>
```

Types:

```ts
type GetDocumentsInput = {
  limit?: number;   // default 50, max 200
  offset?: number;  // default 0
  query?: string;   // optional filename/title filter, P1 if not implemented in MVP
};
```

`import_pdf` must compute SHA-256 in the Rust backend before inserting the document. `relink_document_file` must compute SHA-256 for the new path and compare it to the stored `file_sha256` when available. If hashes differ, show a confirmation warning instead of silently relinking.

### 14.2 Page Commands

```ts
save_page_text(documentId: string, pageNumber: number, text: string): Promise<void>
get_page_text(documentId: string, pageNumber: number): Promise<PageText>
get_pages_text(documentId: string, startPage: number, endPage: number): Promise<PageText[]>
mark_page_text_failed(documentId: string, pageNumber: number, error: string): Promise<void>
```

### 14.3 TOC Commands

```ts
save_toc_nodes(documentId: string, nodes: TocNodeInput[]): Promise<TocNode[]>
get_toc_tree(documentId: string): Promise<TocNode[]>
get_toc_node_for_page(documentId: string, pageNumber: number): Promise<TocNode | null>
update_toc_node(nodeId: string, patch: Partial<TocNode>): Promise<TocNode>
delete_toc_node(nodeId: string): Promise<void>
```

### 14.4 AI Commands

```ts
explain_selection(input: ExplainSelectionInput): Promise<AiResponse>
summarize_page(input: SummarizePageInput): Promise<AiResponse>
summarize_page_range(input: SummarizeRangeInput): Promise<AiResponse>
ask_current_section(input: AskCurrentSectionInput): Promise<AiResponse>
get_or_create_ai_session(input: GetOrCreateSessionInput): Promise<AiSession>
get_session_messages(sessionId: string, limit?: number): Promise<AiMessage[]>
compact_session(sessionId: string): Promise<AiSession>
```

`compact_session` calls the configured AI provider and can fail or consume credits. It must follow the failure behavior in section 10.7.9.

Types:

```ts
type ExplainSelectionInput = {
  documentId: string;
  pageNumber: number;
  selectedText: string;
  anchor?: SelectionAnchor;
};

type SummarizePageInput = {
  documentId: string;
  pageNumber: number;
};

type SummarizeRangeInput = {
  documentId: string;
  startPage: number;
  endPage: number;
};

type AskCurrentSectionInput = {
  documentId: string;
  currentPage: number;
  question: string;
};

type GetOrCreateSessionInput = {
  documentId: string;
  scopeType: 'document' | 'toc_node' | 'page' | 'range' | 'selection';
  scope: Record<string, unknown>;
};

type AiResponse = {
  messageId: string;
  sessionId: string;
  answerMd: string;
  citations: Citation[];
  contextSnapshot: ContextPack;
};
```

### 14.5 Memory Commands

```ts
get_reading_state(documentId: string): Promise<ReadingState | null>
update_reading_state(input: UpdateReadingStateInput): Promise<ReadingState>
get_citations_for_message(messageId: string): Promise<Citation[]>
get_learning_memories(documentId: string): Promise<LearningMemory[]>
upsert_learning_memory(input: UpsertLearningMemoryInput): Promise<LearningMemory>
```

Types:

```ts
type UpdateReadingStateInput = {
  documentId: string;
  currentPageNumber?: number;
  currentTocNodeId?: string | null;
  progressRatio?: number;
  recentPageNumber?: number; // convenience field: backend updates recent_pages_json newest-first, unique, capped at 10
  lastSelectionAnchor?: SelectionAnchor | null;
};

type UpsertLearningMemoryInput = {
  documentId: string;
  concept: string;
  status: 'unknown' | 'confused' | 'learning' | 'understood' | 'review_needed';
  relatedPageNumbers?: number[];
  evidenceMessageIds?: string[];
  confidence?: number;
};
```

MVP only needs reading state and citation retrieval. Learning memory commands can be stubs or P1/P2, but the input type must still exist so the API surface is stable.

### 14.6 Note Commands

```ts
create_annotation(input: CreateAnnotationInput): Promise<Annotation>
get_annotations(input: GetAnnotationsInput): Promise<Annotation[]>
get_annotations_for_page(documentId: string, pageNumber: number): Promise<Annotation[]>
update_annotation(annotationId: string, patch: Partial<Annotation>): Promise<Annotation>
delete_annotation(annotationId: string): Promise<void>
```

Types:

```ts
type CreateAnnotationInput = {
  documentId: string;
  pageNumber: number;
  tocNodeId?: string | null;
  type: 'highlight' | 'note' | 'ai_note' | 'region';
  selectedText?: string;
  noteText?: string;
  color?: string;
  anchor?: SelectionAnchor;
};

type GetAnnotationsInput = {
  documentId: string;
  pageNumber?: number;
  limit?: number;
  offset?: number;
};
```

Default `get_annotations` behavior: `limit = 100`, `offset = 0`. For page rendering, prefer `get_annotations({ documentId, pageNumber })` so the viewer does not load every annotation for heavily annotated PDFs.

### 14.7 Settings Commands

```ts
get_provider_settings(): Promise<ProviderSettings[]>
save_provider_settings(input: ProviderSettingsInput): Promise<ProviderSettings>
set_default_provider(providerId: string): Promise<void>
test_provider(providerId: string): Promise<TestProviderResult>
```

Types:

```ts
type TestProviderResult = {
  ok: boolean;
  providerId: string;
  model?: string;
  latencyMs?: number;
  errorCode?: 'missing_api_key' | 'invalid_base_url' | 'network_error' | 'provider_error' | 'timeout' | 'unknown';
  errorMessage?: string;
};
```

---

## 15. Frontend State Management

Use Zustand or equivalent lightweight store.

### 15.1 Document Store

State:

```ts
currentDocument?: Document;
documents: Document[];
tocTree: TocNode[];
annotations: Annotation[];
```

Actions:

```ts
loadDocuments()
openDocument(id)
importDocument(filePath)
loadToc(id)
loadAnnotations(id)
```

### 15.2 Reader Store

State:

```ts
currentPage: number;
zoom: number;
selectedText?: string;
selectionAnchor?: SelectionAnchor;
activeTocNode?: TocNode;
```

Actions:

```ts
setCurrentPage(page)
setZoom(zoom)
setSelection(selection)
clearSelection()
jumpToPage(page)
jumpToCitation(citation)
```

### 15.3 AI Store

State:

```ts
messages: AiMessage[];
isGenerating: boolean;
activeSession?: AiSession;
lastContextPack?: ContextPack;
```

Actions:

```ts
explainSelection()
summarizePage()
summarizeRange(start, end)
askCurrentSection(question)
saveAssistantMessageAsNote(messageId)
```

### 15.4 Memory Store

State:

```ts
readingState?: ReadingState;
sessionSummary?: string;
recentTurns: AiMessage[];
lastContextPack?: ContextPack;
learningMemories: LearningMemory[];
```

Actions:

```ts
loadReadingState(documentId)
updateCurrentReadingState(partial)
loadRecentSessionTurns(sessionId)
compactCurrentSession()
loadLearningMemories(documentId)
```

The memory store should not become a global dumping ground. It should expose only memory used by context building, citation jump-back, and reading continuity.

---

## 16. Implementation Plan for Coding Agent

### Phase 0 — Project Setup

Tasks:

1. Create Tauri + React + TypeScript app.
2. Add PDF.js and configure `GlobalWorkerOptions.workerSrc` before any PDF load.
3. Verify Tauri CSP allows the PDF.js worker to load.
4. Add SQLite database layer in Rust.
4. Add database migrations.
5. Add basic app shell with three panes.
6. Add provider settings screen.

Acceptance criteria:

1. App launches.
2. SQLite database is created.
3. Settings can be saved and reloaded.
4. Empty reader layout is visible.
5. PDF.js worker configuration is present and does not rely on inline worker fallback.

### Phase 1 — PDF Import and Rendering

Tasks:

1. Implement local PDF import.
2. Store document metadata.
3. Render PDF pages in center viewer.
4. Track current page.
5. Save and restore last page.
6. Add zoom controls.

Acceptance criteria:

1. User can open a PDF.
2. PDF renders correctly.
3. User can scroll pages.
4. Current page updates while scrolling.
5. Closing/reopening restores last page.

### Phase 2 — Native TOC Extraction

Tasks:

1. Use PDF.js `getOutline()`.
2. Resolve outline destinations to page numbers.
3. Store TOC nodes in SQLite.
4. Compute end pages.
5. Display left TOC tree.
6. Click TOC node to jump to page.
7. Determine active TOC node based on current page.

Acceptance criteria:

1. PDFs with native outline show a TOC tree.
2. Clicking a TOC item jumps to the correct page.
3. Active TOC item changes while scrolling.
4. TOC node page ranges are computed.
5. PDFs without outline still open normally.

### Phase 3 — Page Text Extraction and Cache

Tasks:

1. Extract text for current page.
2. Extract text for nearby pages.
3. Extract remaining pages in background.
4. Store page text in SQLite.
5. Add page text status.
6. Add error state for text extraction failure.

Acceptance criteria:

1. Current page text is stored.
2. Page text survives app restart.
3. Background extraction does not block reading.
4. AI actions can retrieve page text from DB.

### Phase 4 — Text Selection and Basic Annotation

Tasks:

1. Enable text selection in PDF text layer.
2. Capture selected text and page number.
3. Show floating action menu: Explain / Highlight / Note.
4. Save highlight annotation.
5. Render saved highlights on page reload if feasible.
6. Save basic text note linked to page.

Acceptance criteria:

1. User can select text.
2. Selected text is captured accurately.
3. User can save a highlight or note.
4. Notes persist after restart.

### Phase 5 — AI Provider Adapter

Tasks:

1. Implement OpenAI-compatible chat completions adapter.
2. Read provider config from settings.
3. Add `test_provider` command.
4. Implement basic error handling:
   - missing API key
   - invalid base URL
   - network error
   - model error
   - timeout
5. Deliberate MVP decision: implement non-streaming responses only, but show a clear loading state and allow cancellation if feasible. Streaming is a P1 upgrade, not an ambiguous optional task.

Acceptance criteria:

1. User can configure provider.
2. Test call succeeds with valid config.
3. User sees clear error messages for invalid config.

### Phase 6 — Context Builder and Memory Manager

Tasks:

1. Implement `buildSelectionContext`.
2. Implement `buildPageContext`.
3. Implement `buildRangeContext`.
4. Implement `findTocNodeForPage`.
5. Include TOC breadcrumb in context.
6. Add token/character budget trimming.
7. Implement `MemoryManager` for reading state, recent turns, session summary, and citations.
8. Implement `ContextPack` with separate `hardEvidence` and `softMemory`.
9. Store context snapshots for AI answers.
10. Add context preview that shows hard evidence and soft memory separately.

Acceptance criteria:

1. Selection context includes selected text, current page, nearby pages, and TOC path.
2. Page context includes page text and TOC path.
3. Range context includes page-separated texts or summary fallback.
4. No workflow sends full document by default.
5. Recent turns are included only within budget.
6. Session summary is included only as soft memory.
7. PDF evidence is never replaced by memory.
8. Context preview clearly shows what is sent to the model.

### Phase 7 — Session Persistence and Memory Compaction

Tasks:

1. Create or reuse an AI session per document/scope.
2. Save user and assistant messages to SQLite.
3. Save citations into `ai_answer_citations`.
4. Save reading state when current page changes.
5. Add manual or lazy `compact_session` command.
6. Mark compacted messages with `is_compacted = 1`.
7. Store compacted summary in `ai_sessions.session_summary`.

Acceptance criteria:

1. Reopening a PDF restores last page and active reading state.
2. Reopening an AI session shows recent messages.
3. Long sessions can be compacted without losing essential context.
4. Old assistant answers still have clickable citation targets.
5. Compacted session summary is treated as soft memory, not source evidence.
6. If compaction fails, old messages remain preserved, `is_compacted` stays unchanged, and the UI shows a non-blocking error.

### Phase 8 — AI Sidebar Workflows

Tasks:

1. Implement Explain Selection.
2. Implement Summarize Current Page.
3. Implement Summarize Page Range.
4. Implement Ask Current Section.
5. Render AI responses in sidebar.
6. Save AI messages to SQLite.
7. Persist sessions by document.

Acceptance criteria:

1. Selecting text and clicking Explain returns an answer.
2. Summarize page works.
3. Summarize range works.
4. Ask current section works when TOC exists, and falls back when no TOC exists.
5. Messages persist after restart.
6. Follow-up questions can use recent session memory without sending the full chat history.
7. Saved context snapshots can be inspected in development mode.
8. Note: citation references in AI answers may render as plain text until Phase 9 implements citation parsing and clickable jump links.

### Phase 9 — Citations and Save as Note

Tasks:

1. Ask model to cite pages using `[p.X]`.
2. Parse citations from assistant response.
3. Render citation links.
4. Click citation to jump to page.
5. Save AI answer as annotation/note.
6. Link saved note to page/range/selection.

Acceptance criteria:

1. AI answer contains page references.
2. Citation links jump to correct pages.
3. Saved AI notes appear in notes panel.
4. Clicking a saved note returns to linked page.

### Phase 10 — Polish and Reliability

Tasks:

1. Loading states.
2. Empty states.
3. Error states.
4. Keyboard shortcuts.
5. Recent PDFs list.
6. Basic performance optimization.
7. Add tests.
8. Add README.

Acceptance criteria:

1. The app is usable for a real PDF reading session.
2. No data loss after restart.
3. AI errors do not crash the app.
4. Non-TOC PDFs still support page/selection/range workflows.

---

## 17. Error Handling Requirements

### 17.1 PDF Errors

Cases:

1. File not found.
2. Encrypted PDF.
3. Corrupt PDF.
4. PDF.js cannot render.
5. Text extraction empty.

File relocation behavior:

1. If `file_path` does not exist, show a `File not found` screen for that document.
2. Provide a `Re-link file` button.
3. Let the user pick a new PDF path.
4. Call `relink_document_file(documentId, newFilePath)`.
5. If stored `file_sha256` exists and the new file hash matches, update `file_path` silently.
6. If the hash differs, warn the user that this appears to be a different file and require confirmation before relinking.
7. If the user cancels, keep the document record and notes but leave it unresolved.

User messages should be specific:

```text
This PDF opened, but no selectable text was detected. It may be a scanned PDF. OCR support is not enabled in this version.
```

### 17.2 AI Errors

Cases:

1. No provider configured.
2. API key missing.
3. Provider request failed.
4. Model returned invalid output.
5. Context too long.
6. Timeout.

User messages:

```text
AI provider is not configured. Open Settings to add an OpenAI-compatible endpoint.
```

```text
The selected range is too long. Try a smaller range or enable range summarization.
```

### 17.3 Database Errors

Must not silently fail.

If save note fails, show:

```text
Failed to save note. Your AI answer is still visible, but it was not persisted.
```

---

## 18. Performance Requirements

MVP targets:

1. Opening a normal PDF should show the first/current page quickly without waiting for full extraction.
2. Native outline extraction should complete before heavier parsing when possible.
3. Text extraction should run progressively and never freeze the reader.
4. AI context building should never scan the whole document unless explicitly requested.
5. For a 300-page text PDF, the app should remain responsive during background extraction.
6. Current page, TOC, notes, and provider settings should load quickly from SQLite.
7. The app should work well without embeddings, OCR, or full-document summarization.

Implementation notes:

1. Use lazy page rendering.
2. Use virtualized page list if continuous scroll becomes slow.
3. Render only visible pages plus a small buffer.
4. Debounce current page updates.
5. Cache page text in DB.
6. Do not render all pages at once.
7. Do not extract all page text synchronously during import.
8. Do not summarize the entire document on import.
9. Do not create embeddings in MVP.
10. Keep AI calls scoped and inspectable.

### 18.1 Fast Defaults

Default settings should favor responsiveness:

```text
nearby_pages_default = 1
max_range_pages_without_confirmation = 10
max_input_chars_cloud = 20000
max_input_chars_local = 8000
background_extraction_batch_size = small, e.g. 3–5 pages
background_extraction_pause_on_scroll = true
```

If the user selects a very large page range, the app should ask the user to narrow the range or run a staged summarization workflow.

### 18.2 Lightweight Dependency Policy

Do not introduce dependencies unless they clearly serve P0.

Allowed P0 dependencies:

```text
- PDF.js
- SQLite library
- Tauri plugins required for filesystem/dialog/window/keychain later
- lightweight state management library
- Markdown renderer
```

Avoid in P0:

```text
- LangChain / LlamaIndex-style frameworks
- vector database
- Python runtime
- OCR libraries
- full-text search frameworks beyond SQLite FTS later
- heavy WYSIWYG editor
```

The AI layer should be simple typed functions, not a large agent framework.

### 18.3 Accuracy Requirements

The app must prefer traceable answers:

1. Every evidence block must include `pageNumber`.
2. Every AI prompt must include source labels like `[p.12]` in context blocks.
3. The model must be instructed not to cite pages that are not in the evidence.
4. If the model response cites a page not present in context, mark the citation as unverified.
5. Saved AI notes must store the context snapshot used to generate them.
6. For MVP, page-level citation is enough; bbox-level citation is P1.

Accuracy failure should be visible, not hidden. If context is missing, extraction failed, or the page has no text, tell the user.


---

## 19. Security and Privacy

### 19.1 Local-First Principle

All PDFs, notes, and reading state are stored locally by default.

### 19.2 AI Context Privacy

Only send the minimum necessary context to the AI provider.

For selection explain, send:

1. Selection.
2. Current page.
3. Nearby page text if needed.
4. TOC path.

Do not send the whole PDF.

### 19.3 API Key Storage

MVP:

1. Store API key in local database only if necessary.
2. Clearly label as prototype-level storage.

P1:

1. Use OS keychain / secure storage.

### 19.4 Local Model Support

Because user may prefer local AI, OpenAI-compatible endpoint should support:

1. LM Studio.
2. Ollama.
3. Local llama.cpp-style server if compatible.

---

## 20. Testing Plan

### 20.1 Unit Tests

Test:

1. TOC flattening.
2. TOC end-page range calculation.
3. Find active TOC node by page.
4. Context builder trimming.
5. Citation parser.
6. Page range validation.
7. Database insert/update/read.
8. `AiSessionScope` canonicalization.
9. `recent_pages_json` update/truncation.
10. Citation regex variants.
11. Learning memory concept normalization.

### 20.2 Integration Tests

Test:

1. Import PDF → store document.
2. Extract outline → store TOC.
3. Extract page text → store page.
4. Select text → AI context builder.
5. Save AI note → retrieve note.
6. Move/rename PDF → re-link with matching SHA-256.
7. Switch PDF → restore previous document session and reading state.

### 20.3 Manual Test PDFs

Keep a test folder with:

1. A PDF with native outline.
2. A PDF without outline but selectable text.
3. A scanned PDF.
4. A long textbook-like PDF.
5. A two-column paper.
6. A PDF with non-English text.

### 20.4 Manual Acceptance Test Script

1. Launch app.
2. Import `sample_with_outline.pdf`.
3. Confirm TOC appears.
4. Click TOC item.
5. Select paragraph.
6. Click Explain.
7. Confirm AI answer cites page.
8. Click citation.
9. Save answer as note.
10. Restart app.
11. Reopen PDF.
12. Confirm last page and note are restored.

---

## 21. Suggested UI Copy

### 21.1 Empty State

```text
Open a PDF to start reading with AI.
```

### 21.2 No TOC

```text
No native table of contents was found. You can still use page-based AI actions.
```

### 21.3 Selection Actions

```text
Explain
Translate
Summarize
Save Highlight
Add Note
```

### 21.4 Context Chips

```text
PDF: {{title}}
Page: {{page}}
Section: {{toc_path}}
Selection: {{char_count}} chars
```

### 21.5 AI Disclaimer

```text
AI answers are generated from the selected PDF context. Check cited pages for verification.
```

---

## 22. Future Extension Design

### 22.1 Printed TOC Extraction, P1

Pipeline:

```text
1. Scan first 5–10% of pages.
2. Search for keywords: Contents, Table of Contents, 目录, 目次.
3. Extract text lines.
4. Detect title + dotted leader + page number patterns.
5. Build candidate TOC items.
6. Ask AI only to clean candidate list, not to read whole book.
7. Map printed page numbers to PDF page numbers.
8. Ask user to confirm.
```

### 22.2 Printed Page Mapping, P1

Store:

```sql
CREATE TABLE page_number_mappings (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  pdf_page INTEGER NOT NULL,
  printed_page TEXT,
  confidence REAL DEFAULT 0.5,
  source TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);
```

### 22.3 Embedding RAG, P2

Add:

1. Chunk table.
2. Embedding model config.
3. Local vector DB or SQLite vector extension.
4. Hybrid retrieval:
   - TOC scope filter.
   - Keyword search.
   - Vector search.
   - Rerank.

Important: do not add this before basic page/TOC context works.

### 22.4 Visual Region Explanation, P2

Flow:

```text
User draws rectangle around formula/figure
→ Capture page canvas crop
→ Send image + nearby text to VLM
→ Answer with page citation
→ Save region note
```

---

## 23. Coding Agent Rules

The coding agent must follow these rules:

0. Optimize for light, fast, and accurate before adding features.
1. Implement P0 only unless explicitly instructed otherwise.
2. Do not add browser extension, collection AI, OCR, embeddings, or handwriting in MVP.
3. Keep changes incremental and testable.
4. Do not fake AI outputs; use provider adapter or clear mock mode.
5. Do not send full PDF text to AI by default.
6. Every AI workflow must go through the context builder.
7. Every saved AI note must link back to document/page/scope.
8. Every citation link must be clickable if it contains a valid page number.
9. If TOC is absent, degrade gracefully to page-based workflows.
10. Use clear error states instead of silent failures.
11. Do not introduce LangChain/LlamaIndex/agent frameworks in MVP.
12. Do not introduce embeddings/vector DB in MVP.
13. Do not introduce OCR in MVP unless explicitly requested.
14. Keep AI workflows as small typed functions: explain_selection, summarize_page, summarize_range, ask_current_section.
15. Always preserve reader responsiveness over background parsing completeness.
16. Use `ContextPack` as the only AI context type. Do not create `BuiltContext` or a union context response.
17. Compute file SHA-256 in Rust backend, not the frontend renderer.
18. Use stable schemas for `scope_json` and `recent_pages_json`; do not invent ad hoc JSON formats.

---

## 24. Definition of Done for MVP

MVP is done when:

1. User can import/open a local PDF.
2. User can read and scroll the PDF.
3. Native TOC is extracted and displayed if available.
4. User can click TOC to jump pages.
5. User can select text in the PDF.
6. User can ask AI to explain selected text.
7. User can summarize current page.
8. User can summarize a page range.
9. AI receives only scoped context, not the whole document.
10. AI answers include page citations.
11. Clicking citations jumps back to PDF pages.
12. User can save AI answer as note.
13. Notes persist after restart.
14. Last-opened page persists after restart.
15. App handles PDFs without TOC.
16. App handles missing AI provider settings gracefully.
17. Reading state persists after restart.
18. AI sessions persist after restart.
19. Recent conversation turns can be reused for follow-up questions.
20. Context snapshots distinguish hard PDF evidence from soft memory.
21. Old AI answers keep citation jump-back targets.
22. `ContextPack` is the only persisted context snapshot type.
23. PDF relocation can be resolved through a re-link flow.
24. Basic keyboard shortcuts are implemented or explicitly marked unavailable in UI help.
25. Provider test returns a typed `TestProviderResult`.

---

## 25. Minimal Vertical Slice

If time is limited, implement this exact vertical slice first:

```text
1. Import one PDF.
2. Render pages.
3. Extract native outline.
4. Extract current page text.
5. Select text.
6. Click Explain.
7. Build context from selected text + current page + TOC path.
8. Call OpenAI-compatible API.
9. Show answer.
10. Save answer as note.
11. Click saved note to return to page.
12. Close and reopen the app.
13. Restore last page, saved note, AI session, and citation jump-back.
```

This is the smallest useful version that proves the product is better than manually uploading a PDF to ChatGPT.

---

## 26. Final Product Principle

Do not build a generic PDF chatbot.

Build this:

> A reading-state-aware AI PDF reader where the AI always knows what the user is reading, can explain exactly that context, and can save answers back to the original PDF location.

The software should win through lightweight workflow, fast context routing, accurate citation jump-back, and persistent reading memory. The LLM is not the memory system; the application is. Do not try to outperform ChatGPT as a model or add heavy document-processing infrastructure too early.
