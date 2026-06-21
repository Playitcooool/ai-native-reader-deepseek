import { useEffect, useRef } from "react";

interface ShortcutsModalProps {
  onClose: () => void;
}

const SHORTCUTS = [
  { key: "← →", desc: "Previous / Next page" },
  { key: "PgUp PgDn", desc: "Previous / Next page" },
  { key: "+ − 0", desc: "Zoom in / out / reset" },
  { key: "E", desc: "Explain selection" },
  { key: "Esc", desc: "Clear selection" },
  { key: "⌘O", desc: "Open PDF" },
  { key: "?", desc: "Toggle this help" },
] as const;

export default function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus trap: Tab cycles within the dialog
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    // Focus the first focusable element on open
    const first = el.querySelector<HTMLElement>("button, [tabindex]:not([tabindex='-1'])");
    first?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !el) return;
      const focusable = el.querySelectorAll<HTMLElement>("button, [tabindex]:not([tabindex='-1'])");
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.4)",
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-primary)", color: "var(--text-primary)",
          borderRadius: 8, padding: "20px 24px",
          minWidth: 280, maxWidth: 360,
          boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
          fontSize: 13,
        }}
      >
        <div id="shortcuts-title" style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>
          Keyboard Shortcuts
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px", fontSize: 12 }}>
          {SHORTCUTS.map((s) => (
            <span key={s.key}>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent-color)" }}>{s.key}</span>
              <span style={{ marginLeft: 16 }}>{s.desc}</span>
            </span>
          ))}
        </div>
        <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
          Click outside or press Esc to close
        </div>
      </div>
    </div>
  );
}
