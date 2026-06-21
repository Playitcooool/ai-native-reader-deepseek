import "./App.css";
import LeftSidebar from "./components/LeftSidebar";
import CenterViewer from "./components/CenterViewer";
import AiSidebar from "./components/AiSidebar";
import { ToastProvider, useToast } from "./components/Toast";
import { useSettingsStore } from "./stores/settingsStore";
import { useDocumentStore } from "./stores/documentStore";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ProviderSettings } from "./stores/settingsStore";
import type { Document } from "./stores/documentStore";

function App() {
  const { addToast } = useToast();
  const setSettings = useSettingsStore((s) => s.setSettings);
  const handleOpenPdf = useDocumentStore((s) => s.handleOpenPdf);
  const setCurrentDocument = useDocumentStore((s) => s.setCurrentDocument);
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
    invoke<Document[]>("get_documents")
      .then((docs) => {
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
      })
      .catch(() => addToast({ type: "error", message: "Failed to restore last document." }));
  }, [setCurrentDocument, addToast]);

  // Listen for native menu File > Open PDF (Cmd+O)
  useEffect(() => {
    const unlisten = listen("menu-open-pdf", () => {
      handleOpenPdf().catch(() => addToast({ type: "error", message: "Failed to open PDF." }));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleOpenPdf, addToast]);

  // Draggable splitters — write to DOM directly during drag for zero-lag resize
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(340);
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
            {leftCollapsed ? "▶" : "◀"}
          </button>
          {!leftCollapsed && <LeftSidebar />}
        </div>
        {!leftCollapsed && <div className="splitter" role="separator" aria-valuenow={leftWidth} aria-valuemin={150} aria-valuemax={500} tabIndex={0} aria-label="Resize left sidebar"
          onMouseDown={(e) => startResize("left", e)} onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); const el = leftRef.current; if (!el) return; const step = e.key === "ArrowLeft" ? -10 : 10; const w = Math.max(150, Math.min(500, (parseInt(el.style.width, 10) || leftWidth) + step)); el.style.width = `${w}px`; setLeftWidth(w); } }} />}
        <div className="center-viewer">
          <CenterViewer />
        </div>
        {!rightCollapsed && <div className="splitter" role="separator" aria-valuenow={rightWidth} aria-valuemin={200} aria-valuemax={600} tabIndex={0} aria-label="Resize right sidebar"
          onMouseDown={(e) => startResize("right", e)} onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); const el = rightRef.current; if (!el) return; const cur = parseInt(el.style.width, 10) || rightWidth; const w = Math.max(200, Math.min(600, cur + (e.key === "ArrowLeft" ? 10 : -10))); el.style.width = `${w}px`; setRightWidth(w); } }} />}
        <div
          ref={rightRef}
          className={`sidebar-right${rightCollapsed ? " collapsed" : ""}`}
          style={{ width: rightCollapsed ? 36 : rightWidth, flex: "none" }}
        >
          <button aria-label={rightCollapsed ? "Expand right sidebar" : "Collapse right sidebar"} className="collapse-btn collapse-right" onClick={() => setRightCollapsed(!rightCollapsed)}>
            {rightCollapsed ? "◀" : "▶"}
          </button>
          {!rightCollapsed && <AiSidebar />}
        </div>
      </div>
    </ToastProvider>
  );
}

export default App;
