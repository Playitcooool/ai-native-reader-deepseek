import { beforeEach, describe, expect, it } from "vitest";
import { useUndoStore } from "../src/stores/undoStore";

describe("undoStore", () => {
  beforeEach(() => {
    useUndoStore.setState({ stack: [] });
  });

  it("undoes the latest operation first", async () => {
    const calls: string[] = [];
    useUndoStore.getState().pushUndo({ label: "first", undo: () => { calls.push("first"); } });
    useUndoStore.getState().pushUndo({ label: "second", undo: () => { calls.push("second"); } });

    await expect(useUndoStore.getState().undoLast()).resolves.toBe("second");
    await expect(useUndoStore.getState().undoLast()).resolves.toBe("first");
    await expect(useUndoStore.getState().undoLast()).resolves.toBeNull();
    expect(calls).toEqual(["second", "first"]);
  });
});
