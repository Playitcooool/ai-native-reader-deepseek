import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import SettingsPanel from "./SettingsPanel";
import { useDocumentStore } from "../stores/documentStore";
import { useNotesStore } from "../stores/notesStore";
import type { Annotation } from "../stores/notesStore";
import TocSidebar from "../features/toc/TocSidebar";
import { useToast } from "./Toast";

type Tab = "toc" | "notes" | "recent" | "settings";

// Format annotations as Markdown for export
function annotationsToMarkdown(annotations: Annotation[], docTitle: string | null): string {
  let md = `# Notes${docTitle ? ` — ${docTitle}` : ""}\n\n`;
  const byPage = new Map<number, typeof annotations>();
  for (const a of annotations) {
    const list = byPage.get(a.page_number) ?? [];
    list.push(a);
    byPage.set(a.page_number, list);
  }
  const sortedPages = Array.from(byPage.keys()).sort((a, b) => a - b);
  for (const page of sortedPages) {
    md += `## Page ${page}\n\n`;
    for (const a of byPage.get(page)!) {
      if (a.selected_text) {
        md += `> ${a.selected_text}\n\n`;
      }
      if (a.note_text) {
        md += `${a.note_text}\n\n`;
      }
    }
  }
  return md;
}

export default function LeftSidebar() {
  const [activeTab, setActiveTab] = useState<Tab>("recent");
  const {
    documents,
    currentDocument,
    tocNodes,
    activeTocNodeId,
    isLoading: docsLoading,
    loadDocuments,
    setCurrentDocument,
    setCurrentPage,
  } = useDocumentStore();
  const { annotations, isLoading: notesLoading, loadAnnotations, deleteAnnotation } = useNotesStore();
  const { addToast } = useToast();

  useEffect(() => {
    loadDocuments().catch(() =>
      addToast({ type: "error", message: "Failed to load documents." })
    );
  }, [loadDocuments, addToast]);

  useEffect(() => {
    if (currentDocument) {
      loadAnnotations(currentDocument.id).catch(() =>
        addToast({ type: "error", message: "Failed to load annotations." })
      );
    }
  }, [currentDocument, loadAnnotations, addToast]);

  const handleOpenDocument = (doc: typeof documents[0]) => {
    setCurrentDocument(doc);
  };

  const handleTocNavigate = (page: number) => {
    const doc = currentDocument;
    if (doc) {
      setCurrentPage(page);
      invoke("update_last_page", { documentId: doc.id, pageNumber: page }).catch(() => {});
    }
  };

  const [isExporting, setIsExporting] = useState(false);

  const handleExportNotes = async () => {
    if (annotations.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      const md = annotationsToMarkdown(annotations, currentDocument?.title ?? null);
      const filePath = await save({
        defaultPath: `${currentDocument?.title ?? "notes"}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, md);
      }
    } catch (err) {
      addToast({ type: "error", message: "Failed to export notes." });
    } finally {
      setIsExporting(false);
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "recent", label: "Recent" },
    { id: "toc", label: "TOC" },
    { id: "notes", label: "Notes" },
    { id: "settings", label: "Settings" },
  ];

  const handleTabKey = (e: React.KeyboardEvent, currentIdx: number) => {
    let nextIdx = currentIdx;
    if (e.key === "ArrowRight") nextIdx = (currentIdx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") nextIdx = (currentIdx + tabs.length - 1) % tabs.length;
    else return;
    e.preventDefault();
    setActiveTab(tabs[nextIdx].id);
  };

  return (
    <div className="sidebar-left">
      <div className="tabs" role="tablist" aria-label="Sidebar tabs">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={activeTab === t.id}
            aria-controls={`tabpanel-${t.id}`}
            onClick={() => setActiveTab(t.id)}
            onKeyDown={(e) => handleTabKey(e, i)}
            className={`tab-btn ${activeTab === t.id ? "active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="tab-content">
        {tabs.map((t) =>
          activeTab === t.id ? (
            <div key={t.id} role="tabpanel" id={`tabpanel-${t.id}`} aria-labelledby={`tab-${t.id}`} style={{ height: "100%", overflowY: "auto" }}>
              {t.id === "recent" && (
                <div>
                  {docsLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
                <SkeletonBlock lines={[70, 40]} />
                <SkeletonBlock lines={[60, 35]} />
                <SkeletonBlock lines={[80, 45]} />
              </div>
            ) : documents.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                No PDFs opened yet. Click "Open PDF" to get started.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {documents.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => handleOpenDocument(doc)}
                    style={{
                      display: "block", width: "100%", padding: "8px 10px", textAlign: "left",
                      background: currentDocument?.id === doc.id ? "var(--accent-color)" : "var(--bg-secondary)",
                      color: currentDocument?.id === doc.id ? "#fff" : "var(--text-primary)",
                      border: "1px solid var(--border-color)", borderRadius: 4, fontSize: 13, cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 500 }}>{doc.title ?? doc.original_filename}</div>
                    {doc.last_page && (
                      <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                        Page {doc.last_page}{doc.page_count ? ` / ${doc.page_count}` : ""}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
            )}
            {t.id === "toc" && (
              currentDocument ? (
                <TocSidebar nodes={tocNodes} activeNodeId={activeTocNodeId} onNavigate={handleTocNavigate} />
              ) : (
                <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Open a PDF to see its table of contents.</p>
              )
            )}
            {t.id === "notes" && (
              currentDocument ? (
                notesLoading ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
                    <SkeletonBlock lines={[50, 30, 80]} />
                    <SkeletonBlock lines={[45, 25, 70]} />
                  </div>
                ) : annotations.length === 0 ? (
                  <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                    No notes yet. Select text and save a highlight or note.
                  </p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <button onClick={handleExportNotes} disabled={isExporting}
                      style={{
                        padding: "6px 12px", background: "var(--accent-color)", color: "#fff",
                        border: "none", borderRadius: 4, fontSize: 12, fontWeight: 500,
                        cursor: "pointer", alignSelf: "flex-start", marginBottom: 4,
                      }}>
                      {isExporting ? "Exporting..." : "📥 Export Notes"}
                    </button>
                    {annotations.map((ann) => (
                      <div key={ann.id} style={{
                        padding: "8px 10px", background: "var(--bg-secondary)",
                        border: "1px solid var(--border-color)", borderRadius: 4, fontSize: 13,
                      }}>
                        <div style={{ fontWeight: 500, marginBottom: 2 }}>
                          {ann.type === "highlight" ? "🔦 Highlight" : ann.type === "note" ? "📝 Note" : ann.type}
                          <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 6 }}>
                            p.{ann.page_number}
                          </span>
                        </div>
                        {ann.selected_text && (
                          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 2, fontStyle: "italic" }}>
                            "{ann.selected_text.slice(0, 80)}{ann.selected_text.length > 80 ? "..." : ""}"
                          </div>
                        )}
                        {ann.note_text && (
                          <div style={{ fontSize: 12 }}>{ann.note_text}</div>
                        )}
                        <button
                          onClick={async () => {
                            if (window.confirm("Delete this note?")) {
                              try { await deleteAnnotation(ann.id); }
                              catch { addToast({ type: "error", message: "Failed to delete annotation." }); }
                            }
                          }}
                          style={{
                            marginTop: 4, padding: "2px 6px", background: "transparent",
                            color: "var(--danger-color)", border: "1px solid var(--danger-color)",
                            borderRadius: 3, fontSize: 11, cursor: "pointer",
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Open a PDF to view notes.</p>
              )
            )}
            {t.id === "settings" && <SettingsPanel />}
          </div>
        ) : null
      )}
      </div>
      <style>{`
        @keyframes skeleton-pulse {
          0% { opacity: 0.3; }
          50% { opacity: 0.6; }
          100% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

function SkeletonBar({ width }: { width: number }) {
  return (
    <div
      style={{
        height: 12, width: `${width}%`, borderRadius: 4,
        background: "var(--bg-tertiary)",
        animation: "skeleton-pulse 1.5s ease-in-out infinite",
      }}
    />
  );
}

function SkeletonBlock({ lines }: { lines: number[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {lines.map((w, i) => <SkeletonBar key={i} width={w} />)}
    </div>
  );
}
