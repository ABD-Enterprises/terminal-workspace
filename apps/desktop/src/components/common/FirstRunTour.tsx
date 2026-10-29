// First-run mini-tour. Renders as a small non-modal toast in the bottom
// right pointing to the two anchor shortcuts (? and Cmd+K). One-shot:
// persists `sawFirstRunTour: true` in app-store on dismiss and never
// renders again unless the user clears app state.
//
// T05 from the feature-parity 20. The chicken-and-egg problem this
// solves: the keyboard cheatsheet is comprehensive, but a user who
// doesn't know it exists can't discover ? to open it.
//
// The tour sits bottom-right, over the Sessions page's QUICK CONNECT
// rail, so it dismisses itself on the first real route change — the
// moment the user shows intent to go somewhere. The one exception is the
// startup redirect: the index route "/" immediately sends the shell to
// "/hosts" while AppShell stays mounted, and that is the app booting,
// not the user navigating.

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { formatPrimaryShortcut } from "../../lib/shortcuts";
import { useAppStore } from "../../store/app-store";

export function FirstRunTour() {
  const sawTour = useAppStore((state) => state.sawFirstRunTour);
  const markSeen = useAppStore((state) => state.markFirstRunTourSeen);
  const openCheatsheet = useAppStore((state) => state.openCheatsheet);
  const openPalette = useAppStore((state) => state.openCommandPalette);
  const location = useLocation();
  const previousPathRef = useRef(location.pathname);

  useEffect(() => {
    const previousPath = previousPathRef.current;
    if (previousPath === location.pathname) {
      return;
    }
    previousPathRef.current = location.pathname;

    // Skip the "/" → "/hosts" startup redirect; every other first
    // change is the user navigating, which dismisses the tour.
    if (previousPath === "/" && location.pathname === "/hosts") {
      return;
    }

    markSeen();
  }, [location.pathname, markSeen]);

  if (sawTour) {
    return null;
  }

  return (
    // Outer + inner are pointer-events-none so the toast never steals
    // clicks from anything beneath it (e.g. a modal footer at a short
    // viewport). Each interactive control (dismiss + shortcut links)
    // opts back in with pointer-events-auto. This is the only correct
    // shape for a non-modal toast that may overlap arbitrary content.
    <div
      role="status"
      aria-label="First-run tour"
      className="pointer-events-none fixed bottom-4 right-4 z-40 max-w-xs"
    >
      <div className="pointer-events-none rounded-2xl border border-emerald-400/40 bg-slate-900/95 px-4 py-3 shadow-2xl shadow-slate-950/70 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-300">
            Welcome
          </p>
          <button
            type="button"
            onClick={markSeen}
            aria-label="Dismiss first-run tour"
            className="pointer-events-auto rounded-md border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 transition hover:border-slate-500 hover:text-white"
          >
            ✕
          </button>
        </div>
        <h3 className="mt-1 text-sm font-semibold text-slate-50">Two shortcuts to know</h3>
        <ul className="mt-2 space-y-2 text-xs text-slate-300">
          <li className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                openCheatsheet();
                markSeen();
              }}
              className="pointer-events-auto text-left text-slate-300 underline-offset-2 hover:text-emerald-200 hover:underline"
            >
              All keyboard shortcuts
            </button>
            <kbd className="rounded-md border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-200">
              ?
            </kbd>
          </li>
          <li className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                openPalette();
                markSeen();
              }}
              className="pointer-events-auto text-left text-slate-300 underline-offset-2 hover:text-emerald-200 hover:underline"
            >
              Jump anywhere
            </button>
            <kbd className="rounded-md border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-200">
              {formatPrimaryShortcut("k")}
            </kbd>
          </li>
        </ul>
        <p className="mt-2 text-[11px] leading-5 text-slate-500">
          Press <kbd className="font-mono">?</kbd> anytime to re-open this list.
        </p>
      </div>
    </div>
  );
}
