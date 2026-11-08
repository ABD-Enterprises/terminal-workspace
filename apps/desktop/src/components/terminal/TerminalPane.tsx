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
import { isReconnectGiveUpNotice } from "./terminal-pane-native-session";

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
  // The pane announces status changes and errors in the active pane whether
  // or not the terminal is reading its own output: status changes are never
  // written to the terminal, and some errors are not either. With screen
  // reader mode on, an error the terminal also prints may be heard twice,
  // which is better than one that is never heard.
  useTerminalScreenReaderMode(terminalRef, screenReaderModeRef, active);
  const paneAnnounces = active;
  const statusAnnouncement = usePaneStatusAnnouncement(
    pane.connectionState,
    host.label,
    paneAnnounces,
    pane.connectionState === "disconnected" ? pane.connectionError : undefined
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

  // #515: user dismissible connection error notice.
  // Cleared whenever leaving "error" or starting a new connection attempt so repeated
  // failures with identical text still surface the error notice.
  const [lastConnectionState, setLastConnectionState] = useState(pane.connectionState);
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  if (pane.connectionState !== lastConnectionState) {
    setLastConnectionState(pane.connectionState);
    if (pane.connectionState !== "error") {
      setDismissedError(null);
    }
  }

  const handleDismiss = useCallback((errText: string | null) => {
    setDismissedError(errText);
  }, []);

  const handleClearDismiss = useCallback(() => {
    setDismissedError(null);
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
      if (restoreFocus) terminalRef.current?.focus();
    },
    [terminalRef]
  );

  return (
    <section
      role="region"
      aria-label={`Terminal session for ${host.label}`}
      className={cn(
        "relative flex h-full flex-col overflow-hidden bg-slate-950/70",
        active ? "ring-1 ring-emerald-400/40" : "ring-1 ring-slate-800/80"
      )}
      onClick={onActivate}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/60 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "inline-flex h-2.5 w-2.5 rounded-full",
              terminalPaneStateStyles[pane.connectionState]
            )}
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-100">{host.label}</span>
              <span className="text-[11px] text-slate-400">
                {formatSessionConnectionState(pane.connectionState)}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">{formatHostAddress(host)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={pane.savedPreview !== null}
              onChange={(event) =>
                setPanePersistOutputPreview(pane.id, event.target.checked ? "" : null)
              }
              className="rounded border-slate-700 bg-slate-950 text-emerald-400 focus:ring-emerald-400/30"
            />
            Save previews
          </label>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleClearDismiss();
              toggleConnectionRef.current();
            }}
            className="rounded-2xl border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
          >
            {pane.connectionState === "connected"
              ? "Disconnect"
              : pane.connectionState === "pendingSecrets"
                ? "Resume"
                : "Connect"}
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
          background split pane does not interrupt what the user is doing;
          the banner stays visible either way. */}
      {/* #515: promote connection error into pane header as dismissible notice */}
      {pane.connectionState === "error" &&
      pane.connectionError &&
      dismissedError !== pane.connectionError &&
      // #510: an unavailable runtime has its own banner below, with the
      // same message; showing both would announce it twice.
      !(runtimeStatusMessage && !runtimeStatusMessage.available) ? (
        <div
          role={paneAnnounces ? "alert" : undefined}
          className="flex items-center justify-between gap-3 border-b border-rose-400/20 bg-rose-400/10 px-4 py-2 text-xs text-rose-100"
        >
          <p className="font-medium">Connection failed: {pane.connectionError}</p>
          <button
            type="button"
            onClick={() => handleDismiss(pane.connectionError ?? null)}
            aria-label="Dismiss error notice"
            className="rounded border border-rose-400/40 px-2 py-0.5 text-[11px] text-rose-200 transition hover:border-rose-300 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {pane.connectionState === "disconnected" && isReconnectGiveUpNotice(pane.connectionError) ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs text-amber-100">
          <p className="font-medium">{pane.connectionError}</p>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleClearDismiss();
              toggleConnectionRef.current();
            }}
            className="rounded-2xl border border-amber-300/50 px-3 py-1 text-xs text-amber-50 transition hover:border-amber-200"
          >
            Retry
          </button>
        </div>
      ) : null}
      {runtimeStatusMessage && !runtimeStatusMessage.available ? (
        <div role="status" className="border-b border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs text-amber-100">
          <p className="font-medium">{runtimeStatusMessage.message}</p>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full" />
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
