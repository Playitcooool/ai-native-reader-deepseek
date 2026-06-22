import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "../../components/Toast";

interface SelectionMenuProps {
  selectedText: string;
  pageNumber: number;
  documentId: string;
  anchor?: { pageNumber: number; selectedText: string; prefix?: string; suffix?: string };
  position: { x: number; y: number } | null;
  onClose: () => void;
  onExplain: () => void;
  onHighlightSaved?: () => void;
  onAsk?: (text: string) => void;
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
  onHighlightSaved,
  onAsk,
}: SelectionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState(false);
  const [noteText, setNoteText] = useState("");
  const { addToast } = useToast();

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
      await invoke("create_annotation", {
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
      onHighlightSaved?.();
      showSaved();
    } catch (err) {
      addToast({ type: "error", message: "Failed to save highlight." });
    }
  };

  const handleSaveNote = async () => {
    if (!noteText.trim()) return;
    try {
      await invoke("create_annotation", {
        input: {
          document_id: documentId,
          page_number: pageNumber,
          type: "note",
          selected_text: selectedText,
          note_text: noteText,
          anchor: anchor ? JSON.stringify(anchor) : null,
        },
      });
      showSaved();
      setNoteText("");
    } catch (err) {
      addToast({ type: "error", message: "Failed to save note." });
    }
  };

  useEffect(() => () => clearTimeout(toastSaved.current), []);

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
      style={{
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
      }}
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
