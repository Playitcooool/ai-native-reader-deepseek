import { create } from "zustand";

interface UndoItem {
  label: string;
  undo: () => Promise<void> | void;
}

interface UndoState {
  stack: UndoItem[];
  pushUndo: (item: UndoItem) => void;
  undoLast: () => Promise<string | null>;
}

export const useUndoStore = create<UndoState>((set, get) => ({
  stack: [],
  pushUndo: (item) => set((state) => ({ stack: [...state.stack.slice(-19), item] })),
  undoLast: async () => {
    const stack = get().stack;
    const item = stack[stack.length - 1];
    if (!item) return null;
    set((state) => ({ stack: state.stack.slice(0, -1) }));
    try {
      await item.undo();
      return item.label;
    } catch (err) {
      set((state) => ({ stack: [...state.stack, item] }));
      throw err;
    }
  },
}));
