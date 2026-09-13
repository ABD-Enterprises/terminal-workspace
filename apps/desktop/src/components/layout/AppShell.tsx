import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAppShellTheme } from "../../hooks/useAppShellTheme";
import { useAutoUpdateCheck } from "../../hooks/useAutoUpdateCheck";
import { useCommandPalette } from "../../hooks/useCommandPalette";
import { useDisconnectNotifications } from "../../hooks/useDisconnectNotifications";
import { useDockBadgeSync } from "../../hooks/useDockBadgeSync";
import { useKeyboardCheatsheet } from "../../hooks/useKeyboardCheatsheet";
import { KeyboardCheatsheet } from "../common/KeyboardCheatsheet";
import { FirstRunTour } from "../common/FirstRunTour";
import { isTauriRuntime } from "../../lib/backend-runtime";
import { navigationItems } from "../../lib/navigation";
import { formatPrimaryShortcut, isPrimaryShortcut } from "../../lib/shortcuts";
import { cn } from "../../lib/utils";
import { useAppStore } from "../../store/app-store";
import { useHostsStore } from "../../store/hosts-store";
import { useSessionsStore } from "../../store/sessions-store";
import { formatHostProtocol } from "../../types/host";
import { PreviewBanner } from "../common/PreviewBanner";
import { UpdateAvailableBanner } from "../common/UpdateAvailableBanner";
import { SessionRestoreManager } from "../terminal/SessionRestoreManager";
import { CommandPaletteDialog } from "./CommandPaletteDialog";
import { Sidebar } from "./Sidebar";
import { useCommandPaletteRows } from "./use-command-palette-rows";

const APP_TITLE = "term-snip";

export function AppShell() {
  useAppShellTheme();
  useCommandPalette();
  useKeyboardCheatsheet();
  // T18 + T17 audit fix: wire the previously-dead notification and
  // dock badge helpers to their actual triggers. Both internally
  // short-circuit when the user has the corresponding opt-in toggle
  // off, so unmounting them isn't needed when disabled.
  useDockBadgeSync();
  useDisconnectNotifications();
  // T19 audit fix: one-shot auto-check on launch when the user
  // opted in. Result banner is surfaced from the Settings page on
  // demand (and via future toast wiring — placeholder).
  useAutoUpdateCheck();

  const location = useLocation();
  const navigate = useNavigate();
  const palette = useCommandPaletteRows();
  const { setPaletteQuery, setPaletteSelectedIndex, inputRef, activeSessionTab } = palette;
  const hosts = useHostsStore((state) => state.hosts);
  const sessionTabs = useSessionsStore((state) => state.tabs);
  const activeSessionTabId = useSessionsStore((state) => state.activeTabId);
  const selectSessionTab = useSessionsStore((state) => state.selectTab);
  const closeTab = useSessionsStore((state) => state.closeTab);
  const duplicateSession = useSessionsStore((state) => state.duplicateSession);
  const activeItem =
    navigationItems.find((item) => location.pathname.startsWith(item.path)) ?? navigationItems[0];
  const commandPaletteOpen = useAppStore((state) => state.commandPaletteOpen);
  const openCommandPalette = useAppStore((state) => state.openCommandPalette);
  const closeCommandPalette = useAppStore((state) => state.closeCommandPalette);
  const workspaceDensity = useAppStore((state) => state.workspaceDensity);
  const sectionShortcutsEnabled = useAppStore((state) => state.sectionShortcutsEnabled);
  useEffect(() => {
    if (commandPaletteOpen) {
      // #257: this effect's primary job is the DOM focus — synchronising with an
      // external system, exactly what effects are for. The index reset rides
      // along because it must happen on open, and it is not redundant with the
      // query-change reset in useCommandPaletteRows: openCommandPalette only flips the open flag
      // (store/app-store.ts), so a palette closed with a query still in it
      // reopens with that query unchanged and no query-change to react to.
      // Runs once per open, not per keystroke.
      setPaletteSelectedIndex(0);
      inputRef.current?.focus();
    }
  }, [commandPaletteOpen, inputRef, setPaletteSelectedIndex]);

  const setWorkspaceDensity = useAppStore((state) => state.setWorkspaceDensity);
  // ---- Native menu wiring -------------------------------------------------
  // The macOS application menu emits `terminal_workspace://menu-event` with a string
  // payload like "menu:nav-hosts". We translate each id into the same actions
  // that the in-app keyboard / palette already wire up. Browser preview has
  // no native menu, so this listener simply does not fire.
  // See parity-and-hardening-plan.md P1-UX4.
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    let unlistenFn: (() => void) | undefined;
    let cancelled = false;

    const dispatchMenu = (id: string) => {
      switch (id) {
        case "menu:settings":
        case "menu:nav-settings":
          navigate("/settings");
          break;
        case "menu:nav-hosts":
          navigate("/hosts");
          break;
        case "menu:nav-sessions":
          navigate("/sessions");
          break;
        case "menu:nav-snippets":
          navigate("/snippets");
          break;
        case "menu:nav-keys":
          navigate("/keys");
          break;
        case "menu:nav-transfers":
          navigate("/transfers");
          break;
        case "menu:command-palette":
          openCommandPalette();
          break;
        case "menu:toggle-density":
          setWorkspaceDensity(workspaceDensity === "compact" ? "comfortable" : "compact");
          break;
        case "menu:next-tab":
        case "menu:prev-tab": {
          if (sessionTabs.length === 0) {
            break;
          }
          const currentIndex = sessionTabs.findIndex((tab) => tab.id === activeSessionTabId);
          const startIndex = currentIndex >= 0 ? currentIndex : 0;
          const direction = id === "menu:prev-tab" ? -1 : 1;
          const nextIndex =
            (startIndex + direction + sessionTabs.length) % sessionTabs.length;
          const nextTabId = sessionTabs[nextIndex]?.id;
          if (nextTabId) {
            selectSessionTab(nextTabId);
            navigate(`/sessions?tabId=${nextTabId}`, { replace: true });
          }
          break;
        }
        case "menu:new-tab":
          // Open the palette so the user can type-to-connect. There is no
          // single canonical "new tab" action in this app — every tab is
          // bound to a host record.
          openCommandPalette();
          navigate("/sessions");
          break;
        case "menu:duplicate-tab": {
          if (!activeSessionTab) {
            break;
          }
          const host = hosts.find((entry) => entry.id === activeSessionTab.hostId);
          if (host) {
            duplicateSession(host, host.label);
            navigate(`/sessions?tabId=${activeSessionTab.id}`);
          }
          break;
        }
        case "menu:close-tab": {
          if (activeSessionTab) {
            closeTab(activeSessionTab.id);
          }
          break;
        }
        case "menu:import-ssh-config":
          // Routes the user to Hosts where the import button lives. A dedicated
          // imperative trigger is queued for P2.
          navigate("/hosts");
          break;
        case "menu:help":
          // M10 / #92: open the project README in the user's default
          // browser. window.open works in both Tauri 2 webviews and
          // the browser preview — Tauri 2 routes external URLs through
          // the OS handler by default. Offline help bundle is the
          // future surface but this stops being a dead menu item.
          if (typeof window !== "undefined") {
            window.open(
              "https://github.com/ABD-Enterprises/term-snip#readme",
              "_blank",
              "noopener,noreferrer"
            );
          }
          break;
        default:
          // Unknown ids should be a no-op (forwards-compat for new menu
          // items added on the Rust side before the renderer learns about
          // them). Log only, do not throw.
          console.warn(`[termsnip] unhandled menu id: ${id}`);
      }
    };

    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<string>("terminal_workspace://menu-event", (event) => {
          dispatchMenu(event.payload);
        })
      )
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        unlistenFn = unlisten;
      })
      .catch(() => {
        // Tauri event API not available (browser preview) — listener silently
        // disabled.
      });

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, [
    activeSessionTab,
    activeSessionTabId,
    closeTab,
    duplicateSession,
    hosts,
    navigate,
    openCommandPalette,
    selectSessionTab,
    sessionTabs,
    setWorkspaceDensity,
    workspaceDensity,
  ]);

  // Bind the macOS window title to the active session so the dock / Mission
  // Control / Cmd-Tab labels reflect what the user is currently looking at.
  // Falls back to the app name when there is no active session, and degrades
  // to document.title in the browser preview path. See parity-and-hardening
  // review §4.7.
  const activeSessionHostForTitle = (() => {
    const tab = sessionTabs.find((entry) => entry.id === activeSessionTabId) ?? sessionTabs[0];
    if (!tab) {
      return undefined;
    }
    return hosts.find((entry) => entry.id === tab.hostId);
  })();
  useEffect(() => {
    const nextTitle = activeSessionHostForTitle
      ? `${APP_TITLE} — ${activeSessionHostForTitle.label} (${formatHostProtocol(activeSessionHostForTitle.protocol)})`
      : APP_TITLE;

    document.title = nextTitle;

    if (!isTauriRuntime()) {
      return;
    }
    let cancelled = false;
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        if (cancelled) {
          return;
        }
        return getCurrentWindow().setTitle(nextTitle);
      })
      .catch((error: unknown) => {
        // #235: this used to swallow everything. The two causes named here are
        // genuinely benign, but an ACL denial is neither — it is a permanent
        // misconfiguration, and silence is why the window title never updated in
        // a packaged build for as long as it didn't. A cancelled effect is the
        // only case we can positively identify as expected, so report the rest.
        if (cancelled) {
          return;
        }
        // Log a flattened message, never the title or the raw error object. The
        // title carries the active host label, and a rejected IPC call can echo
        // its arguments back inside the error payload — logging the object whole
        // would reintroduce the leak by the back door. Tauri's ACL denial text
        // names the missing permission, which is the part worth having.
        const reason = error instanceof Error ? error.message : String(error);
        console.error(
          `[termsnip] window setTitle failed — if this names a permission, add it to capabilities/default.json: ${reason}`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionHostForTitle]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const eventTarget = event.target;
      const targetIsEditable =
        eventTarget instanceof HTMLElement &&
        (eventTarget instanceof HTMLInputElement ||
          eventTarget instanceof HTMLTextAreaElement ||
          eventTarget.isContentEditable ||
          eventTarget.getAttribute("role") === "textbox");

      if (targetIsEditable) {
        return;
      }

      if (isPrimaryShortcut(event, "tab") && sessionTabs.length > 1) {
        event.preventDefault();
        const currentIndex = sessionTabs.findIndex((tab) => tab.id === activeSessionTabId);
        const startIndex = currentIndex >= 0 ? currentIndex : 0;
        const direction = event.shiftKey ? -1 : 1;
        const nextIndex = (startIndex + direction + sessionTabs.length) % sessionTabs.length;
        const nextTabId = sessionTabs[nextIndex]?.id;

        if (nextTabId) {
          selectSessionTab(nextTabId);
          setPaletteQuery("");
          navigate(`/sessions?tabId=${nextTabId}`, { replace: true });
          closeCommandPalette();
        }
        return;
      }

      if (!sectionShortcutsEnabled) {
        return;
      }

      const nextIndex = navigationItems.findIndex((_, index) =>
        isPrimaryShortcut(event, String(index + 1))
      );
      if (nextIndex === -1) {
        return;
      }

      event.preventDefault();
      setPaletteQuery("");
      closeCommandPalette();
      navigate(navigationItems[nextIndex].path);
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    activeSessionTabId,
    closeCommandPalette,
    navigate,
    sectionShortcutsEnabled,
    selectSessionTab,
    sessionTabs,
    setPaletteQuery,
  ]);

  // #112: mark the document for the native shell so macOS-only chrome
  // (window vibrancy, traffic-light inset, translucent sidebar) is applied
  // via CSS only under Tauri — the browser build stays visually identical.
  useEffect(() => {
    if (isTauriRuntime()) {
      document.documentElement.setAttribute("data-tauri", "");
    }
  }, []);

  return (
    <div className="tw-shell flex h-screen w-screen overflow-hidden bg-transparent text-slate-100">
      {/*
        #112: native title bar. Zero-height in the browser build (so the
        e2e/web layout is unchanged); on macOS the `data-tauri` marker gives
        it the title-bar height, making a full-width drag region that clears
        the overlaid traffic lights. `data-tauri-drag-region` lets the user
        drag the window from this strip since titleBarStyle is Overlay.
      */}
      <div data-tauri-drag-region className="tw-titlebar" />
      <SessionRestoreManager />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <PreviewBanner />
        <UpdateAvailableBanner />
        <main
          className={cn(
            "min-h-0 flex-1",
            workspaceDensity === "compact" ? "p-2" : "p-3"
          )}
        >
          <div className="flex h-full min-h-0 flex-col rounded-[20px] border border-slate-800/90 bg-slate-900/60 shadow-2xl shadow-slate-950/40 backdrop-blur-xl">
            <div
              className={cn(
                "flex items-center justify-between gap-3 border-b border-slate-800/90",
                workspaceDensity === "compact" ? "px-3 py-2" : "px-4 py-3"
              )}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <h1 className="text-[17px] font-semibold text-slate-50">{activeItem.label}</h1>
                  <p className="truncate text-[11px] text-slate-500">{activeItem.description}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {sectionShortcutsEnabled ? (
                  <span className="hidden rounded-full border border-slate-700 bg-slate-950/80 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-400 sm:inline-flex">
                    {formatPrimaryShortcut("1")} to {formatPrimaryShortcut("6")}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={openCommandPalette}
                  className="rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-[12px] text-slate-200 transition hover:border-slate-500 hover:text-white"
                >
                  Command Palette {formatPrimaryShortcut("k")}
                </button>
              </div>
            </div>
            <div
              className={cn(
                "min-h-0 flex-1 overflow-hidden",
                workspaceDensity === "compact" ? "px-3 py-2.5" : "px-4 py-3.5"
              )}
            >
              <Outlet />
            </div>
          </div>
        </main>
      </div>

      {commandPaletteOpen ? (
        <CommandPaletteDialog {...palette} />
      ) : null}
      <KeyboardCheatsheet />
      <FirstRunTour />
    </div>
  );
}
