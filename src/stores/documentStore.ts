import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { TocNode } from "../features/toc/TocSidebar";
import { isTauriRuntime } from "../tauriRuntime";

export interface Document {
  id: string;
  title: string | null;
  original_filename: string;
  file_path: string;
  file_sha256: string | null;
  page_count: number | null;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
  last_page: number | null;
  last_zoom: number | null;
  parse_status: string | null;
  has_native_toc: boolean | null;
  document_type: 'pdf' | 'epub';
}

export function documentDisplayTitle(doc: Pick<Document, "title" | "original_filename" | "file_path">): string {
  return doc.title?.trim() || doc.original_filename?.trim() || doc.file_path.split("/").pop() || "Untitled";
}

interface DocumentState {
  documents: Document[];
  currentDocument: Document | null;
  currentPage: number;
  totalPages: number;
  zoom: number;
  tocNodes: TocNode[];
  activeTocNodeId: string | null;
  isLoading: boolean;
  libraryFolder: string | null;
  dailyStats: { todaySeconds: number; weekSeconds: number } | null;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  _onVisibility: (() => void) | null;
  setDocuments: (docs: Document[]) => void;
  setCurrentDocument: (doc: Document | null) => void;
  setCurrentPage: (page: number) => void;
  setTotalPages: (count: number) => void;
  setZoom: (zoom: number) => void;
  setTocNodes: (nodes: TocNode[]) => void;
  setActiveTocNodeId: (id: string | null) => void;
  loadDocuments: () => Promise<void>;
  loadToc: (documentId: string) => Promise<void>;
  handleOpenDocument: () => Promise<void>;
  handleOpenFolder: () => Promise<void>;
  setLibraryFolder: (folder: string | null) => void;
  loadLibraryFolder: () => Promise<void>;
  startHeartbeat: () => void;
  stopHeartbeat: () => void;
  loadReadingStats: () => Promise<void>;
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: [],
  currentDocument: null,
  currentPage: 1,
  totalPages: 0,
  zoom: 1.0,
  tocNodes: [],
  activeTocNodeId: null,
  isLoading: false,
  libraryFolder: null,
  dailyStats: null,
  heartbeatInterval: null,
  _onVisibility: null,
  setDocuments: (documents) => set({ documents }),
  setCurrentDocument: (doc) => {
    if (doc) {
      get().startHeartbeat();
    } else {
      get().stopHeartbeat();
    }
    set({
      currentDocument: doc,
      currentPage: doc?.last_page ?? 1,
      zoom: doc?.last_zoom ?? 1.0,
    });
  },
  setCurrentPage: (page) => set({ currentPage: page }),
  setTotalPages: (count) => set({ totalPages: count }),
  setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(4.0, zoom)) }),
  setTocNodes: (nodes) => set({ tocNodes: nodes }),
  setActiveTocNodeId: (id) => set({ activeTocNodeId: id }),
  setLibraryFolder: (folder) => set({ libraryFolder: folder }),

  startHeartbeat: () => {
    const { heartbeatInterval } = get();
    if (heartbeatInterval) return;

    const tick = () => invoke("record_reading_heartbeat", { seconds: 15 });
    const interval = setInterval(tick, 15_000);

    const onVisibility = () => {
      if (document.hidden) {
        clearInterval(interval);
        set({ heartbeatInterval: null });
      } else {
        get().startHeartbeat();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    set({ heartbeatInterval: interval, _onVisibility: onVisibility });
  },

  stopHeartbeat: () => {
    const { heartbeatInterval, _onVisibility } = get();
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (_onVisibility) document.removeEventListener("visibilitychange", _onVisibility);
    set({ heartbeatInterval: null, _onVisibility: null });
  },

  loadReadingStats: async () => {
    if (!isTauriRuntime()) return;
    try {
      const stats = await invoke<{ today_seconds: number; week_seconds: number }>("get_reading_stats");
      set({ dailyStats: { todaySeconds: stats.today_seconds, weekSeconds: stats.week_seconds } });
    } catch { /* ignore */ }
  },
  loadLibraryFolder: async () => {
    if (!isTauriRuntime()) return;
    try {
      const folder = await invoke<string | null>("get_library_folder");
      set({ libraryFolder: folder });
    } catch { /* ignore */ }
  },
  loadDocuments: async () => {
    if (!isTauriRuntime()) return;
    set({ isLoading: true });
    try {
      const docs = await invoke<Document[]>("get_documents");
      set({ documents: docs, isLoading: false });
    } catch (e) {
      set({ isLoading: false });
      throw e;
    }
  },
  loadToc: async (documentId) => {
    const nodes = await invoke<TocNode[]>("get_toc_tree", { documentId });
    set({ tocNodes: nodes });
  },
  handleOpenDocument: async () => {
    if (!isTauriRuntime()) return;
    const selected = await open({
      multiple: false,
      filters: [{ name: "Documents", extensions: ["pdf", "epub"] }],
    });
    if (!selected) return;
    const doc = await invoke<Document>("import_document", { filePath: selected });
    get().setCurrentDocument(doc);
    if (doc.document_type === 'epub') {
      invoke("extract_epub_content", { documentId: doc.id, filePath: doc.file_path }).catch(() => {});
    }
    const docs = await invoke<Document[]>("get_documents");
    get().setDocuments(docs);
  },
  handleOpenFolder: async () => {
    if (!isTauriRuntime()) return;
    const selected = await open({ directory: true, multiple: false, recursive: true });
    if (!selected) return;
    await invoke("set_library_folder", { path: selected });
    get().setLibraryFolder(selected);
    const docs = await invoke<Document[]>("get_documents");
    get().setDocuments(docs);
  },
}));
