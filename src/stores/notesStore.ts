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
  loadAnnotations: (documentId: string, pageNumber?: number) => Promise<void>;
  deleteAnnotation: (id: string) => Promise<void>;
}

export const useNotesStore = create<NotesState>((set) => ({
  annotations: [],
  loadAnnotations: async (documentId, pageNumber) => {
    try {
      const result = await invoke<Annotation[]>("get_annotations", {
        input: { documentId, pageNumber: pageNumber ?? null },
      });
      set({ annotations: result });
    } catch (err) {
      console.error("Failed to load annotations:", err);
    }
  },
  deleteAnnotation: async (id) => {
    try {
      await invoke("delete_annotation", { annotationId: id });
      set((state) => ({
        annotations: state.annotations.filter((a) => a.id !== id),
      }));
    } catch (err) {
      console.error("Failed to delete annotation:", err);
    }
  },
}));
