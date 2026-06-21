# AI-Native PDF Reader

A **local-first, reading-state-aware** AI PDF reader built with Tauri v2 + React + TypeScript.

The core insight: AI should know **what you're reading** — not just what you type. It tracks your current page, TOC section, selected text, and nearby pages to build precise context for AI explanations — grounded in your document, not in general AI guesses.

## Features

### Implemented (MVP)

- **📂 Open & read PDFs** — native file dialog, single-page view with zoom controls
- **📑 Native TOC extraction** — PDF.js `getOutline()` → hierarchical tree → click to jump
- **📝 Text selection** — selectable text layer with floating action menu (Explain, Highlight, Note)
- **⚡ AI workflows** — Explain Selection, Summarize Page, Summarize Range, Ask Current Section
- **🔗 Citation jump-back** — click `[p.12]` references in AI answers to navigate directly
- **💾 Save as Note** — persist AI answers linked to source page/location
- **🔄 Page memory** — last page and zoom restored on re-open
- **📋 Recent documents** — list of opened PDFs
- **🗂️ Notes panel** — view and delete saved annotations
- **⚙️ Provider settings** — configure any OpenAI-compatible endpoint (OpenAI, LM Studio, Ollama)
- **⌨️ Keyboard shortcuts** — `←`/`→`/`PgUp`/`PgDn` for pages, `+/−/0` for zoom, `E` for explain, `Esc` to clear
- **📄 Background text extraction** — priority queue extracts page text without blocking reading
- **💬 Session persistence** — AI conversation history per document/scope, with manual compaction
- **🔍 Context snapshot inspector** — see exactly what was sent to the AI (hard evidence vs. soft memory)

### Planned (P1/P2)

- Continuous scroll mode
- Printed TOC page detection
- PDF text search (FTS5)
- Streaming AI responses
- Region selection for formulas/figures
- Light/dark theme
- Keyword + TOC-scoped search
- Export notes to Markdown

## Architecture

```
Frontend (React + TypeScript + Vite)
├── PDF Viewer (PDF.js)
├── TOC Sidebar
├── AI Chat Sidebar
├── Notes Panel
└── Settings Panel

Backend (Tauri v2 + Rust)
├── Document Commands
├── SQLite Database (10 tables)
├── AI Provider Adapter (OpenAI-compatible)
├── Context Builder (hard evidence + soft memory)
├── Memory Manager (reading state, sessions, compaction)
└── Citation Store
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 |
| Frontend | React 18 + TypeScript + Vite |
| PDF rendering | PDF.js v4 (bundled worker) |
| State management | Zustand |
| Database | SQLite via rusqlite (bundled) |
| AI API | OpenAI-compatible HTTP (reqwest) |
| Markdown rendering | react-markdown |

### Database Tables

The app creates 10 SQLite tables on first launch:
`documents`, `pages`, `toc_nodes`, `annotations`, `ai_sessions`, `ai_messages`, `reading_states`, `ai_answer_citations`, `learning_memories`, `provider_settings`

## Development

### Prerequisites

- Rust 1.75+ (install via [rustup](https://rustup.rs/))
- Node.js 22+
- macOS (Tauri v2 supports Linux and Windows too)

### Getting Started

```bash
# Install frontend dependencies
npm install

# Run in development mode (starts Vite dev server + Tauri window)
npm run tauri dev
```

### Production Build

```bash
npm run tauri build
```

The bundled app will be in `src-tauri/target/release/bundle/`.

### Running Tests

```bash
npm test
```

### Project Structure

```
src/
├── components/       # React components (PdfViewer, LeftSidebar, AiSidebar, etc.)
├── features/         # Feature modules
│   ├── pdf/         # PDF text layer, text extraction, selection menu
│   ├── toc/         # TOC tree extraction and sidebar component
│   └── citations/   # Citation parser
├── stores/           # Zustand state stores
├── pdfjs.ts         # PDF.js worker configuration
├── App.tsx          # Root component
└── main.tsx         # Entry point

src-tauri/
├── src/
│   ├── commands/    # Tauri command handlers (documents, pages, toc, notes, ai, settings)
│   ├── db/          # Database layer (models, migrations)
│   └── ai/          # AI provider adapter, context builder, prompts
├── Cargo.toml
└── tauri.conf.json
```

## Configuration

Open Settings (left sidebar) to configure an AI provider:

1. **Provider Type**: `OpenAI Compatible` (works with OpenAI, LM Studio, Ollama)
2. **Base URL**: e.g., `https://api.openai.com/v1`
3. **API Key**: Your API key
4. **Model**: e.g., `gpt-4o-mini`

Save, then click **Test Connection** to verify.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `←` / `PageUp` | Previous page |
| `→` / `PageDown` | Next page |
| `+` / `=` | Zoom in |
| `-` | Zoom out |
| `0` | Reset zoom |
| `E` | Explain selection |
| `Esc` | Clear selection |

## Design Principles

Built following the **Light, Fast, Accurate** constraints:

- **Light**: Minimal dependencies, local-first, no heavy background services
- **Fast**: Opens instantly, progressive extraction, never blocks reading
- **Accurate**: Scoped context, page citations, explicit uncertainty

See `ai_native_pdf_reader_design_v0.5_agent_ready.md` for the full design document.
