import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import SettingsPanel from "./SettingsPanel";
import { documentDisplayTitle, useDocumentStore } from "../stores/documentStore";
import { useNotesStore } from "../stores/notesStore";
import type { Annotation } from "../stores/notesStore";
import type { Document } from "../stores/documentStore";
import TocSidebar from "../features/toc/TocSidebar";
import { useToast } from "./Toast";

type Tab = "toc" | "notes" | "recent" | "settings";

// ── File tree types & helpers ──────────────────────────────────

interface FileNode {
  name: string;
  isDir: boolean;
  children: FileNode[];
  document?: Document;
}

function buildFileTree(docs: Document[], folderPath: string): FileNode[] {
  const root: FileNode = {
    name: folderPath.split("/").pop() ?? folderPath,
    isDir: true,
    children: [],
  };

  for (const doc of docs) {
    if (!doc.file_path.startsWith(folderPath)) continue;
    let rel = doc.file_path.slice(folderPath.length);
    if (rel.startsWith("/")) rel = rel.slice(1);
    const parts = rel.split("/");
    if (parts.length === 0) continue;

    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      let child = cur.children.find((c) => c.name === parts[i] && c.isDir);
      if (!child) {
        child = { name: parts[i], isDir: true, children: [] };
        cur.children.push(child);
      }
      cur = child;
    }
    cur.children.push({
      name: parts[parts.length - 1],
      isDir: false,
      children: [],
      document: doc,
    });
  }

  const sortNodes = (nodes: FileNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => { if (n.isDir) sortNodes(n.children); });
  };
  sortNodes(root.children);

  return root.children;
}

function FileTreeView({ nodes, currentId, onSelect }: {
  nodes: FileNode[];
  currentId: string | null;
  onSelect: (doc: Document) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {nodes.map((node, i) => (
        <TreeNodeItem key={node.name + i} node={node} depth={0} currentId={currentId} onSelect={onSelect} />
      ))}
    </div>
  );
}

function TreeNodeItem({ node, depth, currentId, onSelect }: {
  node: FileNode;
  depth: number;
  currentId: string | null;
  onSelect: (doc: Document) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);

  if (!node.isDir) {
    const isActive = node.document?.id === currentId;
    return (
      <button
        onClick={() => node.document && onSelect(node.document)}
        className={`tree-leaf ${isActive ? "active" : ""}`}
        style={{ paddingLeft: 10 + depth * 16 }}
        title={node.name}
      >
        {node.name}
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="tree-folder"
        style={{ paddingLeft: 10 + depth * 16 }}
        title={node.name}
      >
        <span className={`tree-folder-icon ${expanded ? "open" : ""}`}>▶</span>
        <span className="tree-folder-name">{node.name}</span>
      </button>
      {expanded && node.children.map((child, i) => (
        <TreeNodeItem key={child.name + i} node={child} depth={depth + 1} currentId={currentId} onSelect={onSelect} />
      ))}
    </div>
  );
}

// ── End file tree helpers ──────────────────────────────────────

function DocItem({ doc, currentId, onSelect }: { doc: Document; currentId: string | null; onSelect: (doc: Document) => void }) {
  const isActive = doc.id === currentId;
  const meta = doc.document_type === 'epub'
    ? `EPUB · ${doc.page_count ?? "?"} ch`
    : `PDF · ${doc.page_count ?? "?"} pages`;
  return (
    <button
      onClick={() => onSelect(doc)}
      className={`recent-item ${isActive ? "active" : ""}`}
    >
      <span className="recent-item-title">{documentDisplayTitle(doc)}</span>
      <span className="recent-item-meta">{meta}</span>
    </button>
  );
}

// Format annotations as Markdown for export
function annotationsToMarkdown(annotations: Annotation[], docTitle: string | null): string {
  let md = `# Notes${docTitle ? ` — ${docTitle}` : ""}\n\n`;
  const byPage = new Map<number, typeof annotations>();
  for (const a of annotations.filter((ann) => ann.type !== "highlight")) {
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

const TAB_STORAGE_KEY = "reader-left-sidebar-tab";

export default function LeftSidebar() {
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const saved = localStorage.getItem(TAB_STORAGE_KEY);
    return (saved === "recent" || saved === "toc" || saved === "notes" || saved === "settings") ? saved : "recent";
  });
  useEffect(() => { localStorage.setItem(TAB_STORAGE_KEY, activeTab); }, [activeTab]);
  const {
    documents,
    currentDocument,
    tocNodes,
    activeTocNodeId,
    libraryFolder,
    isLoading: docsLoading,
    loadDocuments,
    loadLibraryFolder,
    setCurrentDocument,
    setLibraryFolder,
    setCurrentPage,
  } = useDocumentStore();
  const { annotations, isLoading: notesLoading, loadAnnotations, deleteAnnotation } = useNotesStore();
  const { addToast } = useToast();
  const notes = annotations.filter((ann) => ann.type !== "highlight");

  useEffect(() => {
    loadDocuments().catch(() =>
      addToast({ type: "error", message: "Failed to load documents." })
    );
    loadLibraryFolder();
  }, [loadDocuments, loadLibraryFolder, addToast]);

  useEffect(() => {
    if (currentDocument) {
      loadAnnotations(currentDocument.id).catch(() =>
        addToast({ type: "error", message: "Failed to load annotations." })
      );
    }
  }, [currentDocument, loadAnnotations, addToast]);

  useEffect(() => {
    if (!currentDocument) return;
    const refresh = () => {
      loadAnnotations(currentDocument.id).catch(() =>
        addToast({ type: "error", message: "Failed to load annotations." })
      );
    };
    window.addEventListener("annotations-changed", refresh);
    return () => window.removeEventListener("annotations-changed", refresh);
  }, [currentDocument, loadAnnotations, addToast]);

  const nonFolderDocs = libraryFolder
    ? documents.filter((d) => !d.file_path.startsWith(libraryFolder))
    : [];

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
    if (notes.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      const md = annotationsToMarkdown(notes, currentDocument ? documentDisplayTitle(currentDocument) : null);
      const filePath = await save({
        defaultPath: `${currentDocument ? documentDisplayTitle(currentDocument) : "notes"}.md`,
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
    { id: "toc", label: "Contents" },
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
    <div className="sidebar-body">
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
            <div key={t.id} role="tabpanel" id={`tabpanel-${t.id}`} aria-labelledby={`tab-${t.id}`}>
              {t.id === "recent" && (
                <div>
                  {libraryFolder && (
                    <div className="recent-folder-bar">
                      <span className="folder-name">
                        {libraryFolder.split("/").pop() ?? libraryFolder}
                      </span>
                      <button onClick={async () => {
                        try {
                          await invoke("clear_library_folder");
                          setLibraryFolder(null);
                          await loadDocuments();
                        } catch {}
                      }} title="Disconnect folder">✕</button>
                    </div>
                  )}
                  {docsLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
                <SkeletonBlock lines={[70, 40]} />
                <SkeletonBlock lines={[60, 35]} />
                <SkeletonBlock lines={[80, 45]} />
              </div>
            ) : documents.length === 0 ? (
              <>
                <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                  No PDFs opened yet.
                </p>
                <p style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 4 }}>
                  Press <kbd style={{ padding: "1px 4px", background: "var(--bg-tertiary)", borderRadius: 2, fontFamily: "inherit", border: "1px solid var(--border-color)" }}>Cmd+O</kbd> to open a PDF.
                </p>
              </>
            ) : libraryFolder ? (
              <div>
                <FileTreeView
                  nodes={buildFileTree(documents, libraryFolder)}
                  currentId={currentDocument?.id ?? null}
                  onSelect={handleOpenDocument}
                />
                {nonFolderDocs.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <p className="recent-section-header">Other</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {nonFolderDocs.map((doc) => (
                        <DocItem key={doc.id} doc={doc} currentId={currentDocument?.id ?? null} onSelect={handleOpenDocument} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {documents.map((doc) => (
                  <DocItem key={doc.id} doc={doc} currentId={currentDocument?.id ?? null} onSelect={handleOpenDocument} />
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
                ) : notes.length === 0 ? (
                  <>
                    <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                      No notes yet.
                    </p>
                    <p style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 4 }}>
                      Select text and press <kbd style={{ padding: "1px 4px", background: "var(--bg-tertiary)", borderRadius: 2, fontFamily: "inherit", border: "1px solid var(--border-color)" }}>E</kbd> to explain, or use the menu to highlight/note
                    </p>
                  </>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <button onClick={handleExportNotes} disabled={isExporting}
                      style={{
                        padding: "6px 12px", background: "var(--accent-color)", color: "#fff",
                        border: "none", borderRadius: 4, fontSize: 12, fontWeight: 500,
                        cursor: "pointer", alignSelf: "flex-start", marginBottom: 4,
                      }}>
                      {isExporting ? "Exporting..." : "Export Notes"}
                    </button>
                    {notes.map((ann) => (
                      <div key={ann.id} style={{
                        padding: "8px 10px", background: "var(--bg-secondary)",
                        border: "1px solid var(--border-color)", borderRadius: 4, fontSize: 13,
                      }}>
                        <div style={{ fontWeight: 500, marginBottom: 2 }}>
                          {ann.type === "highlight" ? "Highlight" : ann.type === "note" ? "Note" : ann.type}
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
