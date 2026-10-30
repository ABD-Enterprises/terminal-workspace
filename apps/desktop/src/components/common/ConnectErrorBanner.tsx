import { useConnectErrorStore } from "../../store/connect-error-store";

// Surfaces the last connect failure.
//
// Mounted high in the app shell (next to the preview / demo banners) so the
// message is visible no matter which surface started the connect: the hosts
// page, the quick-connect box, the sidebar's pinned and recent lists, the
// command palette, or the first-run welcome panel.

export function ConnectErrorBanner() {
  const message = useConnectErrorStore((state) => state.message);
  const tone = useConnectErrorStore((state) => state.tone);
  const clearConnectError = useConnectErrorStore((state) => state.clearConnectError);

  if (!message) {
    return null;
  }

  const isWarning = tone === "warning";

  return (
    <div
      role="alert"
      aria-label={isWarning ? "Connection cancelled" : "Connection failed"}
      className={
        isWarning
          ? "flex flex-wrap items-center justify-between gap-3 border-b border-amber-300/40 bg-amber-300/10 px-4 py-2"
          : "flex flex-wrap items-center justify-between gap-3 border-b border-rose-400/40 bg-rose-400/10 px-4 py-2"
      }
    >
      <p
        className={
          isWarning
            ? "text-callout font-medium text-amber-100"
            : "text-callout font-medium text-rose-100"
        }
      >
        {message}
      </p>
      <button
        type="button"
        onClick={clearConnectError}
        className="rounded-control border border-slate-700 px-3 py-1 text-callout text-slate-200 transition hover:border-slate-500 hover:text-white"
      >
        Dismiss
      </button>
    </div>
  );
}
