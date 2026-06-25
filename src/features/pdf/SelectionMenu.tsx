import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "../../components/Toast";
import { useUndoStore } from "../../stores/undoStore";

interface SelectionMenuProps {
  selectedText: string;
  pageNumber: number;
  documentId: string;
  anchor?: { pageNumber: number; selectedText: string; prefix?: string; suffix?: string };
  position: { x: number; y: number } | null;
  onClose: () => void;
  onExplain: () => void;
  onAsk?: (text: string) => void;
  onTranslate?: (text: string) => Promise<string | null>;
}

const highlightColors = ["#fde047", "#86efac", "#93c5fd", "#f0abfc"];

export default function SelectionMenu({
  selectedText,
  pageNumber,
  documentId,
  anchor,
  position,
  onClose,
  onExplain,
  onAsk,
  onTranslate,
}: SelectionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [translating, setTranslating] = useState(false);
  const [translationResult, setTranslationResult] = useState<string | null>(null);
  const { addToast } = useToast();
  const pushUndo = useUndoStore((s) => s.pushUndo);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const toastSaved = useRef<ReturnType<typeof setTimeout>>();

  const showSaved = () => {
    setSaved(true);
    clearTimeout(toastSaved.current);
    toastSaved.current = setTimeout(() => onClose(), 1500);
  };

  const handleSaveHighlight = async (color: string) => {
    try {
      const annotation = await invoke<{ id: string }>("create_annotation", {
        input: {
          document_id: documentId,
          page_number: pageNumber,
          type: "highlight",
          selected_text: selectedText,
          note_text: null,
          color,
          anchor: anchor ? JSON.stringify(anchor) : null,
        },
      });
      pushUndo({
        label: "highlight",
        undo: async () => { await invoke("delete_annotation", { annotationId: annotation.id }); },
      });
      window.dispatchEvent(new Event("annotations-changed"));
      showSaved();
    } catch (err) {
      addToast({ type: "error", message: "Failed to save highlight." });
    }
  };

  const handleSaveNote = async () => {
    if (!noteText.trim()) return;
    try {
      const annotation = await invoke<{ id: string }>("create_annotation", {
        input: {
          document_id: documentId,
          page_number: pageNumber,
          type: "note",
          selected_text: selectedText,
          note_text: noteText,
          anchor: anchor ? JSON.stringify(anchor) : null,
        },
      });
      pushUndo({
        label: "note",
        undo: async () => { await invoke("delete_annotation", { annotationId: annotation.id }); },
      });
      window.dispatchEvent(new Event("annotations-changed"));
      showSaved();
      setNoteText("");
    } catch (err) {
      addToast({ type: "error", message: "Failed to save note." });
    }
  };

  const handleTranslate = async () => {
    if (!onTranslate) return;
    setTranslating(true);
    try {
      const result = await onTranslate(selectedText);
      if (result) {
        setTranslationResult(result);
      }
    } catch {
      addToast({ type: "error", message: "Translation failed." });
    } finally {
      setTranslating(false);
    }
  };

  useEffect(() => () => clearTimeout(toastSaved.current), []);

  // Style helpers
  const menuStyle: React.CSSProperties = {
    position: "fixed",
    top: Math.max(8, (position?.y ?? 0) - 48),
    left: Math.max(8, (position?.x ?? 0)),
    zIndex: 1000,
    display: "flex",
    gap: 4,
    padding: "4px 6px",
    background: "var(--bg-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: 6,
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
    fontSize: 12,
    alignItems: "center",
  };

  // Translation result view
  if (translationResult) {
    return (
      <div
        ref={menuRef}
        role="dialog"
        aria-label="Translation"
        style={{
          position: "fixed",
          top: Math.max(8, (position?.y ?? 0) + 16),
          left: Math.max(8, (position?.x ?? 0)),
          zIndex: 1000,
          maxWidth: 500,
          padding: "10px 14px",
          background: "var(--bg-primary)",
          border: "1px solid var(--border-color)",
          borderRadius: 8,
          boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
          fontSize: 14,
          lineHeight: 1.6,
          color: "var(--text-primary)",
        }}
      >
        <div style={{ marginBottom: 8 }}>{translationResult}</div>
        <button
          autoFocus
          onClick={onClose}
          style={{
            padding: "4px 10px",
            background: "var(--accent-color)",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          Close
        </button>
      </div>
    );
  }

  // Translating loading state
  if (translating) {
    return (
      <div
        ref={menuRef}
        role="status"
        aria-live="polite"
        style={{
          ...menuStyle,
          gap: 6,
        }}
      >
        <span style={{ color: "var(--text-secondary)" }}>Translating…</span>
      </div>
    );
  }

  // Saved indicator
  if (saved) {
    return (
      <div
        ref={menuRef}
        role="status"
        aria-live="polite"
        style={{
          position: "fixed",
          top: Math.max(8, (position?.y ?? 0) - 60),
          left: Math.max(8, (position?.x ?? 0)),
          zIndex: 1000,
          padding: "6px 12px",
          background: "var(--success-color)",
          color: "#fff",
          borderRadius: 6,
          fontSize: 13,
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
        }}
      >
        ✓ Saved
      </div>
    );
  }

  const handleMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key !== "Tab") return;
    const focusable = menuRef.current?.querySelectorAll<HTMLElement>("button, input");
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const keepPdfSelection = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Text selection actions"
      onKeyDown={handleMenuKey}
      style={menuStyle}
    >
      <button
        role="menuitem"
        onMouseDown={keepPdfSelection}
        onClick={() => { onExplain(); onClose(); }}
        style={{
          padding: "4px 10px",
          background: "var(--accent-color)",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        Explain
      </button>
      <button
        role="menuitem"
        onMouseDown={keepPdfSelection}
        onClick={() => { onAsk?.(selectedText); onClose(); }}
        title="Ask about this selection"
        style={{
          padding: "4px 10px",
          background: "transparent",
          color: "var(--text-primary)",
          border: "1px solid var(--border-color)",
          borderRadius: 4,
          fontSize: 12,
        }}
      >
        Ask
      </button>
      <button
        role="menuitem"
        onMouseDown={keepPdfSelection}
        onClick={handleTranslate}
        title="Translate selection"
        style={{
          padding: "4px 10px",
          background: "transparent",
          color: "var(--text-primary)",
          border: "1px solid var(--border-color)",
          borderRadius: 4,
          fontSize: 12,
        }}
      >
        Translate
      </button>
      <div role="group" aria-label="Highlight color" style={{ display: "flex", gap: 3 }}>
        {highlightColors.map((color) => (
          <button
            key={color}
            role="menuitem"
            aria-label={`Highlight ${color}`}
            title="Highlight"
            onMouseDown={keepPdfSelection}
            onClick={() => handleSaveHighlight(color)}
            style={{
              width: 22,
              height: 22,
              background: color,
              border: "1px solid var(--border-color)",
              borderRadius: 4,
              cursor: "pointer",
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
        <input
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Add note..."
          style={{
            width: 120,
            padding: "4px 6px",
            border: "1px solid var(--border-color)",
            borderRadius: 4,
            fontSize: 12,
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSaveNote();
          }}
        />
        {noteText && (
          <button
            role="menuitem"
            onMouseDown={keepPdfSelection}
            onClick={handleSaveNote}
            style={{
              padding: "4px 8px",
              background: "var(--accent-color)",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            Save
          </button>
        )}
      </div>
    </div>
  );
}
