import "./App.css";
import LeftSidebar from "./components/LeftSidebar";
import { ToastProvider, useToast } from "./components/Toast";
import { useSettingsStore } from "./stores/settingsStore";
import { useDocumentStore } from "./stores/documentStore";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";

const CenterViewer = lazy(() => import("./components/CenterViewer"));
const AiSidebar = lazy(() => import("./components/AiSidebar"));
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { ProviderSettings } from "./stores/settingsStore";
import type { Document } from "./stores/documentStore";

function App() {
  const { addToast } = useToast();
  const setSettings = useSettingsStore((s) => s.setSettings);
  const handleOpenPdf = useDocumentStore((s) => s.handleOpenPdf);
  const handleOpenFolder = useDocumentStore((s) => s.handleOpenFolder);
  const setCurrentDocument = useDocumentStore((s) => s.setCurrentDocument);
  const setDocuments = useDocumentStore((s) => s.setDocuments);
  const setLibraryFolder = useDocumentStore((s) => s.setLibraryFolder);
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    invoke<ProviderSettings[]>("get_provider_settings")
      .then((settings) => {
        if (settings && settings.length > 0) {
          setSettings(settings);
        }
      })
      .catch(() => addToast({ type: "error", message: "Failed to load provider settings." }));
  }, [setSettings, addToast]);

  // Auto-restore last opened document on startup
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let docs = await invoke<Document[]>("get_documents");
        const libraryFolder = await invoke<string | null>("get_library_folder");
        if (docs.length > 0) {
          const folder = await open({
            title: "Choose your PDF folder to grant access",
            directory: true,
            multiple: false,
            recursive: true,
            defaultPath: libraryFolder ?? parentDir(docs[0].file_path),
          });
          if (typeof folder === "string") {
            await invoke("set_library_folder", { path: folder });
            setLibraryFolder(folder);
            docs = await invoke<Document[]>("get_documents");
            setDocuments(docs);
          }
        }
        if (cancelled) return;
        if (docs && docs.length > 0) {
          const sorted = [...docs].sort(
            (a, b) =>
              new Date(b.last_opened_at ?? b.created_at).getTime() -
              new Date(a.last_opened_at ?? a.created_at).getTime(),
          );
          if (sorted[0]) {
            setCurrentDocument(sorted[0]);
          }
        }
      } catch {
        if (!cancelled) addToast({ type: "error", message: "Failed to restore last document." });
      }
    })();
    return () => { cancelled = true; };
  }, [setCurrentDocument, setDocuments, setLibraryFolder, addToast]);

  // Listen for native menu File > Open PDF (Cmd+O)
  useEffect(() => {
    const unlisten = listen("menu-open-pdf", () => {
      handleOpenPdf().catch(() => addToast({ type: "error", message: "Failed to open PDF." }));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleOpenPdf, addToast]);

  // Listen for native menu File > Open Folder (Cmd+Shift+O)
  useEffect(() => {
    const unlisten = listen("menu-open-folder", () => {
      handleOpenFolder().catch(() => addToast({ type: "error", message: "Failed to open folder." }));
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [handleOpenFolder, addToast]);

  // Listen for library folder updates (new PDF auto-imported by watcher)
  useEffect(() => {
    const unlisten = listen("library-folder-updated", () => {
      useDocumentStore.getState().loadDocuments();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Draggable splitters — write to DOM directly during drag for zero-lag resize
  const [leftWidth, setLeftWidth] = useState(() => Math.round(window.innerWidth * 0.18));
  const [rightWidth, setRightWidth] = useState(() => Math.round(window.innerWidth * 0.18));
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ side: "left" | "right"; startX: number; startSize: number } | null>(null);

  const onMouseMove = useCallback((e: MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const clamped = Math.max(150, Math.min(d.side === "left" ? 500 : 600, d.startSize + (d.side === "left" ? dx : -dx)));
    const el = d.side === "left" ? leftRef.current : rightRef.current;
    if (el) el.style.width = `${clamped}px`;
  }, []);

  const onMouseUp = useCallback(() => {
    const d = dragRef.current;
    if (!d) { dragRef.current = null; return; }
    const el = d.side === "left" ? leftRef.current : rightRef.current;
    if (el) {
      const w = parseInt(el.style.width, 10);
      if (d.side === "left") setLeftWidth(w); else setRightWidth(w);
    }
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const startResize = useCallback((side: "left" | "right", e: React.MouseEvent) => {
    e.preventDefault();
    const el = side === "left" ? leftRef.current : rightRef.current;
    const w = el ? parseInt(el.style.width, 10) || (side === "left" ? leftWidth : rightWidth) : (side === "left" ? leftWidth : rightWidth);
    dragRef.current = { side, startX: e.clientX, startSize: w };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [leftWidth, rightWidth]);

  return (
    <ToastProvider>
      <div className="app-layout">
        <div
          ref={leftRef}
          className={`sidebar-left${leftCollapsed ? " collapsed" : ""}`}
          style={{ width: leftCollapsed ? 36 : leftWidth, flex: "none" }}
        >
          <button aria-label={leftCollapsed ? "Expand left sidebar" : "Collapse left sidebar"} className="collapse-btn collapse-left" onClick={() => setLeftCollapsed(!leftCollapsed)}>
            {leftCollapsed ? "›" : "‹"}
          </button>
          {!leftCollapsed && <LeftSidebar />}
        </div>
        {!leftCollapsed && <div className="splitter" role="separator" aria-valuenow={leftWidth} aria-valuemin={150} aria-valuemax={500} tabIndex={0} aria-label="Resize left sidebar"
          onMouseDown={(e) => startResize("left", e)} onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); const el = leftRef.current; if (!el) return; const step = e.key === "ArrowLeft" ? -10 : 10; const w = Math.max(150, Math.min(500, (parseInt(el.style.width, 10) || leftWidth) + step)); el.style.width = `${w}px`; setLeftWidth(w); } }} />}
        <div className="center-viewer">
          <Suspense fallback={<div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>}>
            <CenterViewer />
          </Suspense>
        </div>
        {!rightCollapsed && <div className="splitter" role="separator" aria-valuenow={rightWidth} aria-valuemin={200} aria-valuemax={600} tabIndex={0} aria-label="Resize right sidebar"
          onMouseDown={(e) => startResize("right", e)} onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); const el = rightRef.current; if (!el) return; const cur = parseInt(el.style.width, 10) || rightWidth; const w = Math.max(200, Math.min(600, cur + (e.key === "ArrowLeft" ? 10 : -10))); el.style.width = `${w}px`; setRightWidth(w); } }} />}
        <div
          ref={rightRef}
          className={`sidebar-right${rightCollapsed ? " collapsed" : ""}`}
          style={{ width: rightCollapsed ? 36 : rightWidth, flex: "none" }}
        >
          <button aria-label={rightCollapsed ? "Expand right sidebar" : "Collapse right sidebar"} className="collapse-btn collapse-right" onClick={() => setRightCollapsed(!rightCollapsed)}>
            {rightCollapsed ? "‹" : "›"}
          </button>
          {!rightCollapsed && (
            <Suspense fallback={<div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>}>
              <AiSidebar />
            </Suspense>
          )}
        </div>
      </div>
    </ToastProvider>
  );
}

export default App;

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : path;
}
