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
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: [],
  currentDocument: null,
  currentPage: 1,
  totalPages: 0,
  zoom: 1.0,
  tocNodes: [],
  activeTocNodeId: null,
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
  loadDocuments: async () => {
    try {
      const docs = await invoke<Document[]>("get_documents");
      set({ documents: docs });
    } catch (err) {
      console.error("Failed to load documents:", err);
    }
  },
  loadToc: async (documentId) => {
    try {
      const nodes = await invoke<TocNode[]>("get_toc_tree", { documentId });
      set({ tocNodes: nodes });
    } catch (err) {
      console.error("Failed to load TOC:", err);
    }
  },
  handleOpenPdf: async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!selected) return;
      const doc = await invoke<Document>("import_pdf", { filePath: selected });
      get().setCurrentDocument(doc);
      const docs = await invoke<Document[]>("get_documents");
      get().setDocuments(docs);
    } catch (err) {
      console.error("Failed to open PDF:", err);
    }
  },
}));
