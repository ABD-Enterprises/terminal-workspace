// UX-13: toast viewport. Rendered once in AppShell; fixed bottom-center
// stack with a polite live region so destructive + undo announcements reach
// assistive tech. Undo runs the toast action; the X dismisses without it.

import { useToastStore } from "../../store/toast-store";
import { cn } from "../../lib/utils";

export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);
  const dismissToast = useToastStore((state) => state.dismissToast);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-2 px-4"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={cn(
            "pointer-events-auto flex w-full items-center justify-between gap-3 rounded-2xl",
            "border border-slate-700 bg-slate-900/95 px-4 py-3 shadow-2xl shadow-slate-950/60 backdrop-blur-xl"
          )}
        >
          <p className="min-w-0 text-sm text-slate-100">{toast.message}</p>
          <div className="flex shrink-0 items-center gap-2">
            {toast.action ? (
              <button
                type="button"
                onClick={() => {
                  toast.action?.run();
                  dismissToast(toast.id);
                }}
                className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-200 transition hover:border-emerald-400/60 hover:bg-emerald-400/15"
              >
                {toast.action.label}
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismissToast(toast.id)}
              className="rounded-lg px-1.5 py-1 text-xs text-slate-400 transition hover:text-slate-100"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
