// UX-13: one live Undo toast per kind of delete.
//
// Each store keeps a single undo stash, so a newer delete finalises the
// older one. Dismissing the older toast here keeps the screen honest: an
// Undo button is only shown for a deletion that can still be undone. The
// store restore calls are also bound to the deleted record's id, so a stale
// click can never restore a different record.

import { UNDO_TOAST_DURATION_MS, pushToast, useToastStore } from "../store/toast-store";

const liveToastByKind = new Map<string, number>();

export function pushUndoToast(kind: string, message: string, onUndo: () => void): number {
  const previous = liveToastByKind.get(kind);
  if (previous !== undefined) {
    useToastStore.getState().dismissToast(previous);
  }
  const toastId = pushToast({
    message,
    durationMs: UNDO_TOAST_DURATION_MS,
    action: { label: "Undo", run: onUndo },
  });
  liveToastByKind.set(kind, toastId);
  return toastId;
}
