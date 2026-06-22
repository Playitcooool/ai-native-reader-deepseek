# Library Folder — Watched Directory for Auto-Importing PDFs

## Problem

Users can only open PDFs one-by-one via Cmd+O file dialog. Managing a collection
of PDFs requires manually importing each file. There is no way to point the app
at a folder and have all PDFs in it appear automatically.

## Goal

Allow the user to connect a local folder to the app. PDFs in that folder are
auto-imported and appear in the Recent document list. New PDFs added to the
folder (via Finder, downloads, rsync, etc.) appear in real time without user
action.

## Design

### Database migration

Add one table to `src-tauri/src/db/migrations.rs`:

```sql
CREATE TABLE IF NOT EXISTS library_folder (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    folder_path TEXT NOT NULL
);
```

The `CHECK(id = 1)` constraint enforces a single row — exactly one folder at a
time. No multi-folder complexity.

### Backend — new `commands/library.rs`

Three Tauri commands:

| Command | Signature | Behaviour |
|---|---|---|
| `set_library_folder` | `(path: String)` | Save to DB, scan folder for existing PDFs (dedup by `file_path`), start `notify` watcher, emit `library-folder-updated` event |
| `get_library_folder` | → `Option<String>` | Return saved path or `null` |
| `clear_library_folder` | `()` | Delete DB row, drop watcher |

**Scan folder helper** (shared by startup and `set_library_folder`):
1. List all `.pdf` files in the folder (non-recursive)
2. Read all existing `file_path` values from `documents` table
3. For each new PDF: compute SHA256, generate UUID, INSERT row
4. Return count of imported files

**File watcher**:
- Uses `notify::RecommendedWatcher` with `mpsc` channel
- Stored in Tauri managed state as `LibraryState { watcher: Mutex<Option<RecommendedWatcher>> }`
- On `set_library_folder`: drop old watcher (stops watching old path), create new watcher on new path
- Watcher thread opens a second SQLite connection (DB is WAL-mode, safe for concurrent readers)
- On `EventKind::Create` for a `.pdf` file → dedup by `file_path` → insert → emit event
- On `EventKind::Remove` for a `.pdf` file → no action (docs stay in list; `read_file_bytes` will error if opened, handled by existing error path)

**App startup** (`lib.rs` setup):
- Read `library_folder` from DB
- If a folder is configured, scan it and start the watcher

### Frontend

**`documentStore.ts`** — add event listener in the store or `App.tsx`:
- Listen for `library-folder-updated` Tauri event → call `loadDocuments()`

**`SettingsPanel.tsx`** — add a "PDF Library" section:
- Show current folder path or "No folder connected"
- "Choose Folder" button using `open({ directory: true })` from `@tauri-apps/plugin-dialog`
- "Clear" button to disconnect
- Status text showing last scan result

**`LeftSidebar.tsx`** — show folder indicator in Recent tab:
- If a folder is connected, show `📁 Watching: <folder name>` above the document list

### Data flow

```
App startup
  → lib.rs reads library_folder from DB
  → scan folder, import new PDFs
  → start watcher on folder
  → frontend loads documents (existing behaviour)

User picks folder in Settings
  → set_library_folder(path)
  → saves to DB, scans folder, starts watcher
  → frontend refreshes doc list

New PDF copied into folder
  → notify watcher fires Create event
  → checks file_path not in DB → inserts row
  → emits "library-folder-updated"
  → frontend calls loadDocuments()
  → new doc appears in Recent list
```

### Dependencies

- Add `notify` crate to `Cargo.toml` (file watcher, uses FSEvents on macOS)

### Edge cases

- **Duplicate PDFs:** Scan and watcher both dedup by `file_path`
- **PDFs moved/deleted:** Stay in doc list; opening a missing file errors gracefully (existing `read_file_bytes` error path)
- **Folder deleted:** Watcher errors silently; folder path stays in DB, user sees stale docs until they clear the setting
- **Rapid file creation:** `notify` on macOS uses FSEvents which coalesces events
- **Non-recursive:** Top-level PDFs only. Can switch to `RecursiveMode::Recursive` trivially later

### Files changed

| File | Change |
|---|---|
| `src-tauri/Cargo.toml` | Add `notify` dependency |
| `src-tauri/src/db/migrations.rs` | Add `library_folder` table |
| `src-tauri/src/commands/mod.rs` | Add `pub mod library` |
| `src-tauri/src/commands/library.rs` | New file — 3 commands + watcher |
| `src-tauri/src/lib.rs` | Init watcher on startup, register commands |
| `src/stores/documentStore.ts` | Add event listener for `library-folder-updated` |
| `src/components/SettingsPanel.tsx` | Add "PDF Library" section |
| `src/components/LeftSidebar.tsx` | Add folder indicator |
