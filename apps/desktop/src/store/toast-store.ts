// UX-13: transient toast notifications with an optional action (Undo).
//
// Deliberately minimal: a flat stack, auto-dismiss after `durationMs`,
// timers owned by the module (never by components) so a toast outlives the
// surface that pushed it. Rendered once by ToastViewport in AppShell.

import { create } from "zustand";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  message: string;
  action?: ToastAction;
  durationMs: number;
}

interface ToastState {
  toasts: Toast[];
  pushToast: (toast: Omit<Toast, "id">) => number;
  dismissToast: (toastId: number) => void;
}

const dismissTimers = new Map<number, ReturnType<typeof setTimeout>>();
let nextToastId = 1;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],

  pushToast: (toast) => {
    const id = nextToastId++;
    set((state) => ({ toasts: [...state.toasts.slice(-2), { ...toast, id }] }));

    dismissTimers.set(
      id,
      setTimeout(() => {
        dismissTimers.delete(id);
        get().dismissToast(id);
      }, toast.durationMs)
    );

    return id;
  },

  dismissToast: (toastId) => {
    const timer = dismissTimers.get(toastId);
    if (timer !== undefined) {
      clearTimeout(timer);
      dismissTimers.delete(toastId);
    }
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== toastId) }));
  },
}));

export const UNDO_TOAST_DURATION_MS = 5_000;

/** Convenience wrapper so callers don't reach into getState() at every site. */
export function pushToast(toast: Omit<Toast, "id">): number {
  return useToastStore.getState().pushToast(toast);
}
