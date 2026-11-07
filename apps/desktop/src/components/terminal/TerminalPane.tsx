import { useCallback, useEffect, useMemo, useState } from "react";
import "xterm/css/xterm.css";
import { detectSystemColorScheme, resolveTerminalTheme, type TerminalThemeMode } from "../../lib/terminal-themes";
import { cn, formatHostAddress } from "../../lib/utils";
import { useAppStore } from "../../store/app-store";
import { useSessionsStore } from "../../store/sessions-store";
import { type HostRecord } from "../../types/host";
import { formatSessionConnectionState, type SessionPane } from "../../types/session";
import { copyTerminalSelection, pasteIntoTerminal, type TerminalContextMenuPosition } from "./terminal-pane-input-wiring";
import { terminalPaneStateStyles } from "./terminal-pane-state";
import { TerminalContextMenu } from "./TerminalContextMenu";
import { usePaneStatusAnnouncement } from "./use-pane-status-announcement";
import { useTerminalScreenReaderMode } from "./use-terminal-screen-reader-mode";
import { useTerminalPaneSession } from "./use-terminal-pane-session";

interface TerminalPaneProps {
  host: HostRecord;
  pane: SessionPane;
  active: boolean;
  onActivate: () => void;
  onSplit: () => void;
  onClose: () => void;
}

export function TerminalPane({ host, pane, active, onActivate, onSplit, onClose }: TerminalPaneProps) {
  const terminalThemeName = useAppStore((state) => state.terminalTheme);
  const setPanePersistOutputPreview = useSessionsStore((state) => state.setPanePersistOutputPreview);
  const [systemColorScheme, setSystemColorScheme] = useState<TerminalThemeMode>(() => detectSystemColorScheme());

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const handler = (event: MediaQueryListEvent) => setSystemColorScheme(event.matches ? "light" : "dark");
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", handler);
      return () => query.removeEventListener("change", handler);
    }
    query.addListener(handler);
    return () => query.removeListener(handler);
  }, []);

  const resolvedTerminalPalette = useMemo(
    () => resolveTerminalTheme(terminalThemeName, systemColorScheme).entry.palette,
    [terminalThemeName, systemColorScheme]
  );
  const { advanceSearchMatch, clipboardNoticeRef, screenReaderModeRef, closeSearch, containerRef, contextMenuRequestRef, runtimeStatusMessage, searchActiveIndex, searchCaseSensitive, searchInputRef, searchMatches, searchOpen, searchQuery, setSearchCaseSensitive, setSearchQuery, terminalRef, toggleConnectionRef } = useTerminalPaneSession({ host, pane, resolvedTerminalPalette });

  // #510: screen reader support. The setting reaches open terminals, and
  // connection changes in the active pane are announced once each.
  // When the terminal reads its own output, it already says what the pane
  // writes (errors, reconnect notices), so the pane's own announcements step
  // back rather than say everything twice.
  const terminalSpeaks = useTerminalScreenReaderMode(terminalRef, screenReaderModeRef, active);
  const paneAnnounces = active && !terminalSpeaks;
  const statusAnnouncement = usePaneStatusAnnouncement(
    pane.connectionState,
    host.label,
    paneAnnounces
  );

  // #507: right-click opens this menu instead of pasting into the shell, and
  // clipboard outcomes are shown rather than swallowed.
  const [contextMenu, setContextMenu] = useState<{
    position: TerminalContextMenuPosition;
    hasSelection: boolean;
  } | null>(null);
  // Each outcome gets its own id, so a repeated identical message (two copies
  // in a row) still restarts the 2.5-second timer instead of inheriting the
  // first one's.
  const [clipboardNotice, setClipboardNoticeState] = useState<{ id: number; text: string } | null>(
    null
  );
  const showClipboardNotice = useCallback((text: string) => {
    setClipboardNoticeState((current) => ({ id: (current?.id ?? 0) + 1, text }));
  }, []);

  useEffect(() => {
    contextMenuRequestRef.current = (position) =>
      setContextMenu({ position, hasSelection: Boolean(terminalRef.current?.getSelection()) });
    clipboardNoticeRef.current = showClipboardNotice;
  }, [clipboardNoticeRef, contextMenuRequestRef, showClipboardNotice, terminalRef]);

  const clipboardNoticeId = clipboardNotice?.id;
  useEffect(() => {
    if (clipboardNoticeId === undefined) {
      return;
    }
    const timer = window.setTimeout(() => setClipboardNoticeState(null), 2500);
    return () => window.clearTimeout(timer);
  }, [clipboardNoticeId]);

  const closeContextMenu = useCallback(
    ({ restoreFocus }: { restoreFocus: boolean }) => {
      setContextMenu(null);
      if (restoreFocus) {
        terminalRef.current?.focus();
      }
    },
    [terminalRef]
  );

  return (
        <section
          className={cn(
            "flex min-h-[280px] min-w-0 flex-col rounded-[28px] border bg-slate-950/70 transition",
            active ? "border-emerald-400/50 shadow-lg shadow-emerald-950/20" : "border-slate-800/80"
          )}
          onClick={onActivate}
        >
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-100">{host.label}</p>
              <p className="truncate text-xs text-slate-500">
                {formatHostAddress(host)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.18em]",
                  terminalPaneStateStyles[pane.connectionState]
                )}
              >
                {pane.transport}
                {" · "}
                {formatSessionConnectionState(pane.connectionState)}
              </span>
              <label
                className={cn(
                  "flex items-center gap-2 rounded-2xl border px-3 py-1.5 text-xs transition",
                  pane.persistOutputPreview
                    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
                    : "border-slate-700 text-slate-300"
                )}
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                <input
                  type="checkbox"
                  checked={pane.persistOutputPreview}
                  onChange={(event) => {
                    event.stopPropagation();
                    setPanePersistOutputPreview(pane.id, event.target.checked);
                  }}
                  className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-950 accent-emerald-400"
                />
                Save previews
              </label>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleConnectionRef.current();
                }}
                className="rounded-2xl border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                {pane.connectionState === "connected"
                  ? "Disconnect"
                  : pane.connectionState === "pendingSecrets"
                    ? "Resume"
                    : "Reconnect"}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onSplit();
                }}
                className="rounded-2xl border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Split
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose();
                }}
                className="rounded-2xl border border-rose-500/40 px-3 py-1.5 text-xs text-rose-200 transition hover:border-rose-400 hover:text-white"
              >
                Close
              </button>
            </div>
          </header>
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {statusAnnouncement}
          </p>
          {/* #510: the alert role only in the active pane, so an error in a
              background split pane does not interrupt what the user is doing,
              and not while the terminal reads its own output, which already
              includes the error; the banner stays visible either way. */}
          {pane.connectionState === "error" &&
          pane.connectionError &&
          // #510: an unavailable runtime has its own banner below, with the
          // same message; showing both would announce it twice.
          !(runtimeStatusMessage && !runtimeStatusMessage.available) ? (
            <div role={paneAnnounces ? "alert" : undefined} className="border-b border-rose-400/20 bg-rose-400/10 px-4 py-2 text-xs text-rose-100">
              <p className="font-medium">Connection failed: {pane.connectionError}</p>
            </div>
          ) : null}
          {runtimeStatusMessage && !runtimeStatusMessage.available ? (
            <div role={paneAnnounces ? "alert" : undefined} className="border-b border-rose-400/20 bg-rose-400/10 px-4 py-2 text-xs text-rose-100">
              <p>{runtimeStatusMessage.message}</p>
              {runtimeStatusMessage.installHint ? (
                <p className="mt-1 text-rose-100/80">{runtimeStatusMessage.installHint}</p>
              ) : null}
            </div>
          ) : null}
          <div className="relative min-h-0 flex-1">
            <div ref={containerRef} className="absolute inset-0 px-3 py-3" />
            <TerminalContextMenu
              position={contextMenu?.position ?? null}
              hasSelection={contextMenu?.hasSelection ?? false}
              onCopy={() => {
                if (terminalRef.current) copyTerminalSelection(terminalRef.current, showClipboardNotice);
              }}
              onPaste={() => {
                if (terminalRef.current) pasteIntoTerminal(terminalRef.current, showClipboardNotice);
              }}
              onClear={() => terminalRef.current?.clear()}
              onClose={closeContextMenu}
            />
            <p
              role="status"
              aria-live="polite"
              className={cn(
                "pointer-events-none absolute bottom-3 right-3 z-10 rounded-xl border border-slate-700 bg-slate-950/95 px-3 py-1.5 text-xs text-slate-200 shadow-lg transition-opacity",
                clipboardNotice ? "opacity-100" : "opacity-0"
              )}
            >
              {clipboardNotice?.text ?? ""}
            </p>
            {searchOpen ? (
              <div
                className="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/95 px-3 py-2 shadow-lg shadow-slate-950/40 backdrop-blur"
                onClick={(event) => event.stopPropagation()}
              >
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      closeSearch();
                      return;
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      advanceSearchMatch(event.shiftKey ? -1 : 1);
                      return;
                    }
                    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") {
                      event.preventDefault();
                      advanceSearchMatch(event.shiftKey ? -1 : 1);
                    }
                  }}
                  placeholder="Find in scrollback"
                  aria-label="Find in terminal scrollback"
                  className="w-56 rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60"
                />
                <span className="min-w-[60px] text-center text-[11px] tabular-nums text-slate-400">
                  {searchQuery
                    ? searchMatches.length === 0
                      ? "no match"
                      : `${searchActiveIndex + 1}/${searchMatches.length}`
                    : "—"}
                </span>
                <button
                  type="button"
                  onClick={() => advanceSearchMatch(-1)}
                  disabled={searchMatches.length === 0}
                  title="Previous match (Shift+Enter or ⇧⌘G)"
                  aria-label="Previous match"
                  className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => advanceSearchMatch(1)}
                  disabled={searchMatches.length === 0}
                  title="Next match (Enter or ⌘G)"
                  aria-label="Next match"
                  className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => setSearchCaseSensitive((value) => !value)}
                  title={searchCaseSensitive ? "Case-sensitive (click to disable)" : "Case-insensitive (click to enable)"}
                  aria-label="Toggle case sensitivity"
                  aria-pressed={searchCaseSensitive}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs transition",
                    searchCaseSensitive
                      ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100"
                      : "border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white"
                  )}
                >
                  Aa
                </button>
                <button
                  type="button"
                  onClick={closeSearch}
                  title="Close search (Esc)"
                  aria-label="Close search"
                  className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
                >
                  ✕
                </button>
              </div>
            ) : null}
          </div>
        </section>
  );
}
