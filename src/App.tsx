import "./App.css";
import LeftSidebar from "./components/LeftSidebar";
import { ToastProvider, useToast } from "./components/Toast";
import { useSettingsStore } from "./stores/settingsStore";
import { useDocumentStore } from "./stores/documentStore";
import { Suspense, lazy, startTransition, useCallback, useEffect, useState } from "react";
import { useAiStore } from "./stores/aiStore";
import { useUndoStore } from "./stores/undoStore";

const CenterViewer = lazy(() => import("./components/CenterViewer"));
const AiSidebar = lazy(() => import("./components/AiSidebar"));
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ProviderSettings } from "./stores/settingsStore";
import type { Document } from "./stores/documentStore";
import { isTauriRuntime } from "./tauriRuntime";

function App() {
  const { addToast } = useToast();
  const setSettings = useSettingsStore((s) => s.setSettings);
  const handleOpenDocument = useDocumentStore((s) => s.handleOpenDocument);
  const handleOpenFolder = useDocumentStore((s) => s.handleOpenFolder);
  const undoLast = useUndoStore((s) => s.undoLast);
  const setCurrentDocument = useDocumentStore((s) => s.setCurrentDocument);
  const setDocuments = useDocumentStore((s) => s.setDocuments);
  const setLibraryFolder = useDocumentStore((s) => s.setLibraryFolder);
  const currentDocument = useDocumentStore((s) => s.currentDocument);
  const theme = useSettingsStore((s) => s.theme);
  const [leftOpen, setLeftOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInputDraft, setAiInputDraft] = useState<string>();

  const openAiPanel = useCallback((draft?: string) => {
    setLeftOpen(false);
    setAiOpen(true);
    if (draft) setAiInputDraft(draft);
  }, []);

  const goHome = useCallback(() => {
    setAiOpen(false);
    setLeftOpen(false);
    startTransition(() => setCurrentDocument(null));
  }, [setCurrentDocument]);

  const openLibraryPanel = useCallback(() => {
    setAiOpen(false);
    setLeftOpen(true);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const handleUndo = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.target as HTMLElement | null)?.isContentEditable) return;
      e.preventDefault();
      undoLast()
        .then((label) => {
          if (label) window.dispatchEvent(new Event("annotations-changed"));
        })
        .catch(() => addToast({ type: "error", message: "Undo failed." }));
    };
    window.addEventListener("keydown", handleUndo);
    return () => window.removeEventListener("keydown", handleUndo);
  }, [undoLast, addToast]);

  useEffect(() => {
    useAiStore.getState().setSessionId(null);
    useAiStore.getState().setMessages([]);
  }, [currentDocument?.id]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    invoke<ProviderSettings[]>("get_provider_settings")
      .then((settings) => {
        if (settings && settings.length > 0) {
          setSettings(settings);
        }
      })
      .catch(() => addToast({ type: "error", message: "Failed to load provider settings." }));
  }, [setSettings, addToast]);

  // Load library on startup; documents open only after the user picks one.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    (async () => {
      try {
        const docs = await invoke<Document[]>("get_documents");
        const libraryFolder = await invoke<string | null>("get_library_folder");
        if (cancelled) return;
        setDocuments(docs);
        setLibraryFolder(libraryFolder);
      } catch {
        if (!cancelled) addToast({ type: "error", message: "Failed to load library." });
      }
    })();
    return () => { cancelled = true; };
  }, [setCurrentDocument, setDocuments, setLibraryFolder, addToast]);

  // Listen for native menu File > Open PDF (Cmd+O)
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisten = listen("menu-open-pdf", () => {
      handleOpenDocument().catch(() => addToast({ type: "error", message: "Failed to open document." }));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleOpenDocument, addToast]);

  // Listen for native menu File > Open Folder (Cmd+Shift+O)
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisten = listen("menu-open-folder", () => {
      handleOpenFolder().catch(() => addToast({ type: "error", message: "Failed to open folder." }));
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [handleOpenFolder, addToast]);

  // Listen for library folder updates (new PDF auto-imported by watcher)
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisten = listen("library-folder-updated", () => {
      useDocumentStore.getState().loadDocuments();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  return (
    <ToastProvider>
      <div className={currentDocument ? "reader-shell" : "app-layout library-shell"}>
        {!currentDocument && (
          <div className="sidebar-left">
            <LeftSidebar />
          </div>
        )}
        <div className="center-viewer">
          <Suspense fallback={<div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>}>
            <CenterViewer onBackHome={goHome} onOpenLibrary={openLibraryPanel} onOpenAi={openAiPanel} />
          </Suspense>
        </div>
        {leftOpen && (
          <div className="drawer-backdrop" onMouseDown={() => setLeftOpen(false)}>
            <aside className="reader-drawer" onMouseDown={(e) => e.stopPropagation()}>
              <button aria-label="Close drawer" className="sheet-close" onClick={() => setLeftOpen(false)}>×</button>
              <LeftSidebar />
            </aside>
          </div>
        )}
        {aiOpen && (
          <div className="drawer-backdrop" onMouseDown={() => setAiOpen(false)}>
            <aside className="ai-sheet" onMouseDown={(e) => e.stopPropagation()}>
              <button aria-label="Close AI" className="sheet-close" onClick={() => setAiOpen(false)}>×</button>
            <Suspense fallback={<div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>}>
              <AiSidebar
                draftInput={aiInputDraft}
                onDraftConsumed={() => setAiInputDraft(undefined)}
              />
            </Suspense>
            </aside>
          </div>
        )}
      </div>
    </ToastProvider>
  );
}

export default App;
