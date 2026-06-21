import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface SelectionMenuProps {
  selectedText: string;
  pageNumber: number;
  documentId: string;
  anchor?: { pageNumber: number; selectedText: string; prefix?: string; suffix?: string };
  position: { x: number; y: number } | null;
  onClose: () => void;
  onExplain: () => void;
}

export default function SelectionMenu({
  selectedText,
  pageNumber,
  documentId,
  anchor,
  position,
  onClose,
  onExplain,
}: SelectionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState(false);
  const [noteText, setNoteText] = useState("");

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const handleSaveHighlight = async () => {
    try {
      await invoke("create_annotation", {
        input: {
          document_id: documentId,
          page_number: pageNumber,
          type: "highlight",
          selected_text: selectedText,
          anchor: anchor ? JSON.stringify(anchor) : null,
        },
      });
      setSaved(true);
    } catch (err) {
      console.error("Failed to save highlight:", err);
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
      setSaved(true);
      setNoteText("");
    } catch (err) {
      console.error("Failed to save note:", err);
    }
  };

  if (saved) {
    return (
      <div
        ref={menuRef}
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

  return (
    <div
      ref={menuRef}
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
        onClick={handleSaveHighlight}
        style={{
          padding: "4px 10px",
          background: "transparent",
          color: "var(--text-primary)",
          border: "1px solid var(--border-color)",
          borderRadius: 4,
          fontSize: 12,
        }}
      >
        Highlight
      </button>
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
