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
          ? "flex flex-wrap items-center justify-between gap-3 tw-banner-warn border-b border-amber-300/40 px-4 py-2"
          : "flex flex-wrap items-center justify-between gap-3 tw-banner-error border-b border-rose-400/40 px-4 py-2"
      }
    >
      <p className="text-callout font-medium text-[color:var(--shell-text)]">{message}</p>
      <button
        type="button"
        onClick={clearConnectError}
        className="rounded-control border border-[color:var(--shell-border)] px-3 py-1 text-callout text-[color:var(--shell-text)] transition hover:border-[color:var(--shell-muted)]"
      >
        Dismiss
      </button>
    </div>
  );
}
