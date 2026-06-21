import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface Annotation {
  id: string;
  document_id: string;
  page_number: number;
  toc_node_id: string | null;
  type: string;
  selected_text: string | null;
  note_text: string | null;
  color: string | null;
  anchor_json: string | null;
  created_at: string;
  updated_at: string;
}

interface NotesState {
  annotations: Annotation[];
  isLoading: boolean;
  loadAnnotations: (documentId: string, pageNumber?: number) => Promise<void>;
  deleteAnnotation: (id: string) => Promise<void>;
}

export const useNotesStore = create<NotesState>((set) => ({
  annotations: [],
  isLoading: false,
  loadAnnotations: async (documentId, pageNumber) => {
    set({ isLoading: true });
    try {
      const result = await invoke<Annotation[]>("get_annotations", {
        input: { documentId, pageNumber: pageNumber ?? null },
      });
      set({ annotations: result, isLoading: false });
    } catch (e) {
      set({ isLoading: false });
      throw e;
    }
  },
  deleteAnnotation: async (id) => {
    await invoke("delete_annotation", { annotationId: id });
    set((state) => ({
      annotations: state.annotations.filter((a) => a.id !== id),
    }));
  },
}));
