import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface AiMessage {
  id: string;
  session_id: string;
  role: string;
  content: string;
  page_number: number | null;
  context_snapshot_json: string | null;
  citations_json: string | null;
  created_at: string;
}

interface AiState {
  messages: AiMessage[];
  sessionId: string | null;
  isGenerating: boolean;
  lastWorkflowInput: Record<string, any> | null;
  setSessionId: (id: string | null) => void;
  addMessage: (msg: AiMessage) => void;
  setMessages: (msgs: AiMessage[]) => void;
  setGenerating: (g: boolean) => void;
  runWorkflow: (input: {
    documentId: string;
    documentTitle?: string;
    mode: string;
    pageNumber: number;
    selectedText?: string;
    startPage?: number;
    endPage?: number;
    question?: string;
  }) => Promise<string | null>;
  retryLastWorkflow: () => Promise<string | null>;
  loadSessionMessages: (sessionId: string) => Promise<void>;
}

export const useAiStore = create<AiState>((set, get) => ({
  messages: [],
  sessionId: null,
  isGenerating: false,
  lastWorkflowInput: null,
  setSessionId: (id) => set({ sessionId: id }),
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setMessages: (msgs) => set({ messages: msgs }),
  setGenerating: (g) => set({ isGenerating: g }),

  runWorkflow: async (input) => {
    set({ isGenerating: true, lastWorkflowInput: input as Record<string, any> });
    try {
      const result = await invoke<{
        message_id: string;
        session_id: string;
        answer_md: string;
        context_snapshot: any;
      }>("run_ai_workflow", {
        input: {
          document_id: input.documentId,
          document_title: input.documentTitle ?? null,
          mode: input.mode,
          page_number: input.pageNumber,
          selected_text: input.selectedText ?? null,
          start_page: input.startPage ?? null,
          end_page: input.endPage ?? null,
          question: input.question ?? null,
          existing_session_id: get().sessionId,
        },
      });

      set({ sessionId: result.session_id });

      // Add messages to local state
      const now = new Date().toISOString();
      const userMsg: AiMessage = {
        id: `user_${Date.now()}`,
        session_id: result.session_id,
        role: "user",
        content: input.selectedText ?? input.mode,
        page_number: input.pageNumber,
        context_snapshot_json: null,
        citations_json: null,
        created_at: now,
      };
      const asstMsg: AiMessage = {
        id: result.message_id,
        session_id: result.session_id,
        role: "assistant",
        content: result.answer_md,
        page_number: input.pageNumber,
        context_snapshot_json: JSON.stringify(result.context_snapshot),
        citations_json: null,
        created_at: now,
      };

      set((s) => ({
        messages: [...s.messages, userMsg, asstMsg],
      }));

      return result.answer_md;
    } finally {
      set({ isGenerating: false });
    }
  },

  retryLastWorkflow: async () => {
    const last = get().lastWorkflowInput;
    if (!last) return null;
    return get().runWorkflow(last as any);
  },

  loadSessionMessages: async (sessionId) => {
    try {
      const msgs = await invoke<AiMessage[]>("get_session_messages", {
        sessionId,
        limit: 50,
      });
      set({ messages: msgs, sessionId });
    } catch (err) {
      console.error("Failed to load session messages:", err);
    }
  },
}));
