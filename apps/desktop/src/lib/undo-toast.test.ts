import { afterEach, describe, expect, it, vi } from "vitest";
import { useToastStore } from "../store/toast-store";
import { pushUndoToast } from "./undo-toast";

describe("pushUndoToast", () => {
  afterEach(() => {
    vi.useRealTimers();
    useToastStore.setState({ toasts: [] });
  });

  it("dismisses the previous toast of the same kind, but not other kinds", () => {
    vi.useFakeTimers();
    pushUndoToast("one", "first", vi.fn());
    pushUndoToast("two", "other kind", vi.fn());
    pushUndoToast("one", "second", vi.fn());

    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      "other kind",
      "second",
    ]);
  });

  it("runs the supplied undo action from the toast", () => {
    vi.useFakeTimers();
    const onUndo = vi.fn();
    pushUndoToast("three", "message", onUndo);
    useToastStore.getState().toasts[0].action?.run();
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
