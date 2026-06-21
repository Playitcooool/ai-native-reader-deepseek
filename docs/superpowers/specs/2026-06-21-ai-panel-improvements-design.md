# AI Assistant Panel Improvements

**Date**: 2026-06-21
**Status**: Approved

## Problem

The AI sidebar panel lacks four features present in modern AI chat interfaces: the ability to switch between AI models mid-conversation, streaming (live) output rendering, visibility into what context is sent with each request, and the ability to browse and resume past conversations.

## Scope

Five features layered onto the existing AI sidebar:

1. Model switching (pick from saved providers)
2. Streaming output (token-by-token via Tauri Channel API)
3. Markdown render (already exists — minor styling refinement)
4. Context viewer (collapsible panel per message)
5. Session history sidebar (browse past conversations)

## Architecture

### Streaming via Tauri Channel API

Backend emits tokens through a `tauri::ipc::Channel<String>` passed as a command parameter. Frontend receives tokens in a callback, accumulates them, and re-renders incrementally.

```
Frontend                     Backend (Rust)
   │                            │
   │  invoke("stream_ai_workflow", input, channel)
   │───────────────────────────>│
   │                            │
   │  channel.onmessage(token)  │  SSE: "data: {...delta.content...}"
   │<───────────────────────────│  provider.rs parses SSE chunks
   │                            │
   │  channel.onmessage(token)  │  ...
   │<───────────────────────────│
   │                            │
   │  channel.onmessage("[DONE]")│  SSE: "data: [DONE]"
   │<───────────────────────────│  Saves complete message to DB
   │                            │
```

### State Management

Extended `aiStore` with:

| State | Type | Purpose |
|-------|------|---------|
| `currentProviderId` | `string \| null` | Currently selected provider ID |
| `streamingContent` | `string` | Accumulating partial response text |
| `isStreaming` | `boolean` | True while tokens are arriving |
| `sessions` | `AiSession[]` | Session list for current document |
| `activeTab` | `'chat' \| 'sessions'` | Which tab is shown in AI sidebar |

### Non-breaking

The existing `run_ai_workflow` command and `runWorkflow` action remain untouched. The streaming path is selected when the frontend detects a streaming-capable provider.

## Detailed Design

### 1. Model Selector

**File**: `src/components/AiSidebar.tsx` — add in the header bar (~line 185)

A `<select>` dropdown listing all saved providers from `settingsStore.settings`. Shows the current model name prominently. On change: calls Tauri `set_default_provider` + updates `aiStore.currentProviderId`. Disabled during streaming. "Manage Providers..." link opens Settings tab in left sidebar.

**New backend command**: None — reuses existing `get_provider_settings` + `set_default_provider`.

### 2. Streaming Pipeline

#### Backend

**`src-tauri/src/ai/provider.rs`** — new function:
```rust
pub async fn stream_chat_completion(
    base_url: &str, api_key: &str, model: &str,
    messages: Vec<ChatMessage>,
    temperature: Option<f64>, max_tokens: Option<u32>,
    sender: tauri::ipc::Channel<String>,
) -> Result<String, String>  // returns full content for DB persistence
```

- Sends `POST` with `"stream": true`
- Reads `reqwest::Response::bytes_stream()`, parses SSE `data: {...}` lines
- On each delta: `sender.send(token)`
- On `[DONE]`: `sender.send("[DONE]")`
- Returns the concatenated full content string for DB persistence
- Error: `sender.send("[ERROR]: ...")`

**`src-tauri/src/commands/ai.rs`** — new command:
```rust
#[tauri::command]
pub async fn stream_ai_workflow(
    app: AppHandle, state: State<'_, DbState>,
    input: RunAiWorkflowInput,
    on_token: Channel<String>,
) -> Result<AiWorkflowResult, String>
```

- Same context building as `run_ai_workflow` (reuses `context_builder.rs` and `prompts.rs`)
- Calls `provider::stream_chat_completion` with the channel
- After streaming completes: saves user + assistant messages to DB
- Returns final result

#### Frontend

**`src/stores/aiStore.ts`** — new state/actions:
```typescript
streamingContent: string
isStreaming: boolean
channel: Channel<string> | null

startStreaming(input): void {
  const channel = new Channel<string>();
  channel.onmessage = (data) => {
    if (data === "[DONE]") this.finalizeStreaming();
    else if (data.startsWith("[ERROR]")) this.handleStreamError(data);
    else set(state => { state.streamingContent += data });
  };
  invoke("stream_ai_workflow", { input, onToken: channel });
}
```

**`src/components/AiSidebar.tsx`** — streaming render:
```tsx
{isStreaming && (
  <div className="message assistant streaming">
    <div className="message-label">AI</div>
    <div className="markdown-content">
      <ReactMarkdown components={renderers(msg)}>
        {streamingContent}
      </ReactMarkdown>
    </div>
    <span className="streaming-cursor" />
  </div>
)}
```

### 3. Markdown Render

Already exists via `react-markdown` with citation link rendering. Minor refinement:
- Better styling for code blocks (inline `--font-mono`)
- Proper dark mode for markdown elements
- Keep the existing citation `[p.X]` link handling — no changes needed there

### 4. Context Viewer

**File**: `src/components/AiSidebar.tsx` — add inside the message rendering loop (~line 240)

```tsx
{msg.context_snapshot_json && (
  <details className="context-viewer">
    <summary>Context sent to AI</summary>
    <div className="context-items">
      {parsed.hard_evidence.map(item => (
        <div key={item.id} className="context-item">
          <span className="context-icon">📄</span>
          <span className="context-text">{item.text}</span>
        </div>
      ))}
      {parsed.warnings?.map((w, i) => (
        <div key={i} className="context-item warning">
          <span className="context-icon">⚠️</span>
          <span>{w}</span>
        </div>
      ))}
    </div>
  </details>
)}
```

Parsing: inline function that `JSON.parse(msg.context_snapshot_json)` and extracts the fields.

### 5. Session History Sidebar

**New file**: `src/components/AiSessionHistory.tsx` — ~80 lines

A panel shown when `activeTab === 'sessions'`. Lists sessions from `aiStore.sessions`. Each item shows the session's first question / title and a relative timestamp.

**Actions**:
- Click a session → `aiStore.switchSession(id)` → loads messages from backend
- "New Session" button → creates fresh session via `get_or_create_ai_session`
- Active session highlighted

**New backend command**: `list_sessions` — returns `AiSession[]` for a document:
```rust
#[tauri::command]
pub fn list_sessions(state: State<'_, DbState>, document_id: String) -> Result<Vec<AiSession>, String>
```

**Tab switching in AiSidebar**: Two tab buttons at the top of the content area:
```tsx
<div className="ai-tabs">
  <button onClick={() => setActiveTab('chat')} 
          className={activeTab === 'chat' ? 'active' : ''}>Chat</button>
  <button onClick={() => setActiveTab('sessions')}
          className={activeTab === 'sessions' ? 'active' : ''}>Sessions</button>
</div>
```

## Files Changed

### New Files
| File | Lines | Purpose |
|------|-------|---------|
| `src/components/AiSessionHistory.tsx` | ~80 | Session list panel |

### Modified Files
| File | Changes |
|------|---------|
| `src/stores/aiStore.ts` | +streaming state, +sessions state, +currentProviderId, +startStreaming, +loadSessions, +switchSession |
| `src/stores/settingsStore.ts` | Minor: expose `defaultProviderId` computed |
| `src/components/AiSidebar.tsx` | +model selector dropdown, +streaming render, +context viewer, +tab switching |
| `src-tauri/src/ai/provider.rs` | +`stream_chat_completion()` with SSE parsing |
| `src-tauri/src/commands/ai.rs` | +`stream_ai_workflow()` command, +`list_sessions()` command |
| `src-tauri/src/lib.rs` | Register new commands |

## Verification

1. `npm run dev` — TypeScript checker + Vite build pass
2. `cargo build` in `src-tauri/` — Rust compiles
3. Manual test in app:
   - Open PDF → AI sidebar → model selector shows saved providers → switching works
   - Ask a question → response streams in token by token
   - Context viewer shows expandable context per message
   - Sessions tab shows past conversations → clicking one loads its history
   - New session button creates fresh conversation
4. Fallback: set a provider that doesn't support streaming → `run_ai_workflow` still works

## Future Considerations (explicitly out of scope)

- Message editing / deletion
- Regenerate individual messages
- Learning memories integration
- Streaming abort/cancel mid-generation
- Conversation export
