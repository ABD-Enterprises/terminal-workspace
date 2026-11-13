// UX-13: shared undo-window timer for undoable deletes.
//
// A destructive action that supports Undo removes the record immediately,
// stashes it, and starts an undo window: if the window expires (or another
// delete replaces it), the deferred side effects — vault tombstones, native
// Keychain GC — run for real. Cancelling (Undo) aborts the window and its
// side effects with it.
//
// Timers live outside React: undo windows survive re-renders and must fire
// even if the component that opened them unmounted.

const timers = new Map<string, { timeout: ReturnType<typeof setTimeout>; onExpire: () => void }>();

function take(key: string) {
  const existing = timers.get(key);
  if (existing !== undefined) {
    clearTimeout(existing.timeout);
    timers.delete(key);
  }
  return existing;
}

/**
 * Start (or replace) the undo window for `key`. Replacing an existing window
 * expires it immediately, so a second delete can never orphan the first
 * record's deferred cleanup.
 */
export function startUndoWindow(key: string, ttlMs: number, onExpire: () => void): void {
  const replaced = take(key);
  replaced?.onExpire();
  timers.set(key, {
    timeout: setTimeout(() => {
      timers.delete(key);
      onExpire();
    }, ttlMs),
    onExpire,
  });
}

/** Cancel the undo window without running the expiry side effects. */
export function cancelUndoWindow(key: string): void {
  take(key);
}

/** Run the expiry side effects immediately (used when a new delete replaces). */
export function expireUndoWindowNow(key: string, onExpire: () => void): void {
  const existing = take(key);
  if (!existing) {
    return;
  }
  onExpire();
}
