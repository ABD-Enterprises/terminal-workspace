// One-shot banner on /hosts reminding users that ~/.ssh/config can be
// bulk-imported. Renders after the cold-start welcome is past (i.e. the
// user has at least one host) but only until they dismiss it once. The
// `sawImportCallout` flag in app-store persists the dismissal.
//
// T03 from the feature-parity 20. WelcomePanel covers the empty-state
// cold-start case (which has its own Import CTA); this callout is the
// "by the way, in case you missed it" reminder for users who added
// their first host another way.

import { useAppStore } from "../../store/app-store";

interface ImportSshCalloutProps {
  onImport: () => void;
}

export function ImportSshCallout({ onImport }: ImportSshCalloutProps) {
  const sawCallout = useAppStore((state) => state.sawImportCallout);
  const markSeen = useAppStore((state) => state.markImportCalloutSeen);

  if (sawCallout) {
    return null;
  }

  return (
    <div
      role="status"
      aria-label="Import SSH config callout"
      className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/5 px-4 py-3"
    >
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300">
          Tip
        </p>
        <p className="mt-0.5 text-sm text-slate-200">
          Bulk-import the rest of your existing hosts from <span className="font-mono text-[12px] text-slate-300">~/.ssh/config</span>.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => {
            onImport();
            markSeen();
          }}
          className="rounded-xl bg-emerald-400 px-3 py-1.5 text-xs font-medium text-slate-950 transition hover:bg-emerald-300"
        >
          Import now
        </button>
        <button
          type="button"
          onClick={markSeen}
          aria-label="Dismiss import callout"
          className="rounded-md border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-400 transition hover:border-slate-500 hover:text-white"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
