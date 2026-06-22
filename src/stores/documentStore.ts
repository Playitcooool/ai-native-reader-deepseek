import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { TocNode } from "../features/toc/TocSidebar";

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
  setDocuments: (docs: Document[]) => void;
  setCurrentDocument: (doc: Document | null) => void;
  setCurrentPage: (page: number) => void;
  setTotalPages: (count: number) => void;
  setZoom: (zoom: number) => void;
  setTocNodes: (nodes: TocNode[]) => void;
  setActiveTocNodeId: (id: string | null) => void;
  loadDocuments: () => Promise<void>;
  loadToc: (documentId: string) => Promise<void>;
  handleOpenPdf: () => Promise<void>;
  handleOpenFolder: () => Promise<void>;
  scrollToPage: (page: number) => void;
  setLibraryFolder: (folder: string | null) => void;
  loadLibraryFolder: () => Promise<void>;
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
  setDocuments: (documents) => set({ documents }),
  setCurrentDocument: (doc) =>
    set({
      currentDocument: doc,
      currentPage: doc?.last_page ?? 1,
      zoom: doc?.last_zoom ?? 1.0,
    }),
  setCurrentPage: (page) => set({ currentPage: page }),
  setTotalPages: (count) => set({ totalPages: count }),
  setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(4.0, zoom)) }),
  setTocNodes: (nodes) => set({ tocNodes: nodes }),
  setActiveTocNodeId: (id) => set({ activeTocNodeId: id }),
  scrollToPage: (page) => set({ currentPage: page }),
  setLibraryFolder: (folder) => set({ libraryFolder: folder }),
  loadLibraryFolder: async () => {
    try {
      const folder = await invoke<string | null>("get_library_folder");
      set({ libraryFolder: folder });
    } catch { /* ignore */ }
  },
  loadDocuments: async () => {
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
  handleOpenPdf: async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!selected) return;
    const doc = await invoke<Document>("import_pdf", { filePath: selected });
    get().setCurrentDocument(doc);
    const docs = await invoke<Document[]>("get_documents");
    get().setDocuments(docs);
  },
  handleOpenFolder: async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    await invoke("set_library_folder", { path: selected });
    get().setLibraryFolder(selected);
    const docs = await invoke<Document[]>("get_documents");
    get().setDocuments(docs);
  },
}));
