import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { launchHostSession as sharedLaunchHostSession } from "../../lib/launch-host-session";
import { navigationItems } from "../../lib/navigation";
import { scorePaletteMatch } from "../../lib/palette-score";
import { selectMostRecentlyConnectedHosts, selectMostRecentlyRunSnippets } from "../../lib/recents";
import { useAppStore } from "../../store/app-store";
import { applyHostFilters, useHostsStore } from "../../store/hosts-store";
import { useSessionsStore } from "../../store/sessions-store";
import { useSnippetsStore } from "../../store/snippets-store";
import { useTransfersStore } from "../../store/transfers-store";
import { hostSupportsSftp } from "../../types/host";

export function useCommandPaletteRows() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteSelectedIndex, setPaletteSelectedIndex] = useState(0);
  const hosts = useHostsStore((state) => state.hosts);
  const markConnected = useHostsStore((state) => state.markConnected);
  const sessionTabs = useSessionsStore((state) => state.tabs);
  const sessionPanes = useSessionsStore((state) => state.panes);
  const activeSessionTabId = useSessionsStore((state) => state.activeTabId);
  const queuePaneCommand = useSessionsStore((state) => state.queuePaneCommand);
  const selectSessionTab = useSessionsStore((state) => state.selectTab);
  const closeTab = useSessionsStore((state) => state.closeTab);
  const duplicateSession = useSessionsStore((state) => state.duplicateSession);
  const splitTab = useSessionsStore((state) => state.splitTab);
  const setSplitDirection = useSessionsStore((state) => state.setSplitDirection);
  const snippets = useSnippetsStore((state) => state.snippets);
  const markSnippetRun = useSnippetsStore((state) => state.markSnippetRun);
  const setActiveTransferHost = useTransfersStore((state) => state.setActiveHost);
  const closeCommandPalette = useAppStore((state) => state.closeCommandPalette);
  const setSidebarSearch = useAppStore((state) => state.setSidebarSearch);
  const activeSessionTab = sessionTabs.find((tab) => tab.id === activeSessionTabId) ?? sessionTabs[0];
  const activeSessionPane = activeSessionTab
    ? sessionPanes[activeSessionTab.activePaneId]
    : undefined;

  const focusSessionTab = (tabId: string, replace = false) => {
    selectSessionTab(tabId);
    setPaletteQuery("");
    navigate(`/sessions?tabId=${tabId}`, replace ? { replace: true } : undefined);
    closeCommandPalette();
  };


  const [previousPaletteQuery, setPreviousPaletteQuery] = useState(paletteQuery);
  if (paletteQuery !== previousPaletteQuery) {
    setPreviousPaletteQuery(paletteQuery);
    setPaletteSelectedIndex(0);
  }

  // ---- Native menu wiring -------------------------------------------------
  // The macOS application menu emits `terminal_workspace://menu-event` with a string
  // payload like "menu:nav-hosts". We translate each id into the same actions
  // that the in-app keyboard / palette already wire up. Browser preview has
  // no native menu, so this listener simply does not fire.
  // See parity-and-hardening-plan.md P1-UX4.

  const trimmedQuery = paletteQuery.trim();

  const matchingSections = trimmedQuery
    ? navigationItems
        .map((item) => ({
          item,
          score: scorePaletteMatch(trimmedQuery, `${item.label} ${item.description}`),
        }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score)
        .map(({ item }) => item)
    : navigationItems;

  const matchingHosts = applyHostFilters(hosts, {
    query: paletteQuery,
    activeGroup: "all",
    activeTag: "all",
    favoritesOnly: false,
  }).slice(0, 6);
  const matchingSessionTabs = trimmedQuery
    ? sessionTabs
        .map((tab) => {
          const host = hosts.find((entry) => entry.id === tab.hostId);
          const haystack = `${tab.title} ${host?.label ?? ""} ${host?.hostname ?? ""} ${host?.username ?? ""}`;
          return { tab, score: scorePaletteMatch(trimmedQuery, haystack) };
        })
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 6)
        .map(({ tab }) => tab)
    : sessionTabs.slice(0, 6);
  const matchingSnippets = trimmedQuery
    ? snippets
        .map((snippet) => {
          const haystack = [
            snippet.title,
            snippet.description,
            snippet.command,
            snippet.tags.join(" "),
          ].join(" ");
          return { snippet, score: scorePaletteMatch(trimmedQuery, haystack) };
        })
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 6)
        .map(({ snippet }) => snippet)
    : snippets.slice(0, 6);

  const focusHost = (hostId: string) => {
    setPaletteQuery("");
    setSidebarSearch("");
    navigate(`/hosts?focus=${hostId}`);
    closeCommandPalette();
  };

  const launchHostSession = async (hostId: string) => {
    const host = hosts.find((entry) => entry.id === hostId);
    if (!host) {
      return;
    }
    const result = await sharedLaunchHostSession(host);
    if (!result.ok || !result.tabId) {
      if (result.errorMessage) {
        console.warn(`[palette] ${result.errorMessage}`);
      }
      return;
    }
    setPaletteQuery("");
    navigate(`/sessions?tabId=${result.tabId}`);
    closeCommandPalette();
  };

  const openHostTransfers = (hostId: string) => {
    setActiveTransferHost(hostId);
    setPaletteQuery("");
    navigate("/transfers");
    closeCommandPalette();
  };

  const manageHostTrust = (hostId: string) => {
    setPaletteQuery("");
    navigate(`/keys?scanHost=${encodeURIComponent(hostId)}&autoScan=1`);
    closeCommandPalette();
  };

  const focusSection = (path: string) => {
    setPaletteQuery("");
    navigate(path);
    closeCommandPalette();
  };

  const focusSession = (tabId: string) => {
    focusSessionTab(tabId);
  };

  const runSnippetInActivePane = (snippetId: string) => {
    const snippet = snippets.find((entry) => entry.id === snippetId);
    if (!snippet) {
      return;
    }

    if (!activeSessionPane || !activeSessionTab) {
      setPaletteQuery("");
      navigate("/snippets");
      closeCommandPalette();
      return;
    }

    queuePaneCommand(activeSessionPane.id, snippet.command, snippet.title);
    markSnippetRun(snippet.id);
    markConnected(activeSessionPane.hostId);
    setPaletteQuery("");
    navigate(`/sessions?tabId=${activeSessionTab.id}`);
    closeCommandPalette();
  };

  // ---- Active-session command surface ---------------------------------------
  // When a session tab is open, expose the commands a power user reaches for
  // most often (split, duplicate, files, close) directly in the palette so
  // they do not require a tab-bar visit. Closes the gap called out in
  // docs/parity-and-hardening-review.md §4.2.
  type ActiveCommand = {
    key: string;
    label: string;
    sublabel: string;
    run: () => void;
  };
  const activeSessionHost = activeSessionPane
    ? hosts.find((entry) => entry.id === activeSessionPane.hostId)
    : undefined;
  const activeSessionCommands: ActiveCommand[] = (() => {
    if (!activeSessionTab || !activeSessionHost) {
      return [];
    }
    const tabId = activeSessionTab.id;
    const host = activeSessionHost;
    return [
      {
        key: "active:duplicate",
        label: "Duplicate this tab",
        sublabel: `Open a second SSH session to ${host.label}`,
        run: () => {
          duplicateSession(host, host.label);
          setPaletteQuery("");
          navigate(`/sessions?tabId=${tabId}`);
          closeCommandPalette();
        },
      },
      {
        key: "active:split-h",
        label: "Split horizontally",
        sublabel: `Add a side-by-side pane for ${host.label}`,
        run: () => {
          setSplitDirection(tabId, "horizontal");
          splitTab(tabId, host);
          setPaletteQuery("");
          navigate(`/sessions?tabId=${tabId}`);
          closeCommandPalette();
        },
      },
      {
        key: "active:split-v",
        label: "Split vertically",
        sublabel: `Stack a new pane below for ${host.label}`,
        run: () => {
          setSplitDirection(tabId, "vertical");
          splitTab(tabId, host);
          setPaletteQuery("");
          navigate(`/sessions?tabId=${tabId}`);
          closeCommandPalette();
        },
      },
      ...(hostSupportsSftp(host.protocol)
        ? [
            {
              key: "active:files",
              label: "Open files (SFTP)",
              sublabel: `Browse the remote filesystem on ${host.hostname}`,
              run: () => openHostTransfers(host.id),
            },
          ]
        : []),
      {
        key: "active:close",
        label: "Close this tab",
        sublabel: `Disconnect and remove "${activeSessionTab.title}"`,
        run: () => {
          closeTab(tabId);
          setPaletteQuery("");
          closeCommandPalette();
        },
      },
    ];
  })();

  const matchingActiveCommands = activeSessionCommands.filter((command) => {
    if (!paletteQuery.trim()) {
      return true;
    }
    const haystack = `${command.label} ${command.sublabel}`.toLowerCase();
    return haystack.includes(paletteQuery.trim().toLowerCase());
  });

  // ---- Recent --------------------------------------------------------------
  const recentSnippet = selectMostRecentlyRunSnippets(snippets, 1)[0];
  const recentHost = selectMostRecentlyConnectedHosts(hosts, 1)[0];

  type RecentCommand = ActiveCommand;
  const recentCommands: RecentCommand[] = [
    ...(recentSnippet && activeSessionPane
      ? [
          {
            key: `recent:rerun-${recentSnippet.id}`,
            label: `Rerun: ${recentSnippet.title}`,
            sublabel: "Send the most recently executed snippet to the active pane",
            run: () => runSnippetInActivePane(recentSnippet.id),
          },
        ]
      : []),
    ...(recentHost && (!activeSessionTab || activeSessionTab.hostId !== recentHost.id)
      ? [
          {
            key: `recent:reconnect-${recentHost.id}`,
            label: `Reconnect to ${recentHost.label}`,
            sublabel: `Last connected ${recentHost.lastConnectedAt ?? "recently"}`,
            run: () => launchHostSession(recentHost.id),
          },
        ]
      : []),
  ];

  const matchingRecent = recentCommands.filter((command) => {
    if (!paletteQuery.trim()) {
      return true;
    }
    const haystack = `${command.label} ${command.sublabel}`.toLowerCase();
    return haystack.includes(paletteQuery.trim().toLowerCase());
  });

  // ---- Flat keyboard-nav row list -----------------------------------------
  // All visible row primary-actions in render order. The palette tracks a
  // single `paletteSelectedIndex` into this list so ArrowUp/Down + Enter work
  // across every section without per-section focus management.
  type PaletteRow = { key: string; run: () => void };
  const paletteRows: PaletteRow[] = [
    ...matchingActiveCommands.map((command) => ({ key: command.key, run: command.run })),
    ...matchingRecent.map((command) => ({ key: command.key, run: command.run })),
    ...matchingSections.map((item) => ({ key: `section:${item.path}`, run: () => focusSection(item.path) })),
    ...matchingSessionTabs.map((tab) => ({ key: `session:${tab.id}`, run: () => focusSession(tab.id) })),
    ...matchingHosts.map((host) => ({ key: `host:${host.id}`, run: () => launchHostSession(host.id) })),
    ...matchingSnippets.map((snippet) => ({
      key: `snippet:${snippet.id}`,
      run: () => runSnippetInActivePane(snippet.id),
    })),
  ];
  const clampedSelectedIndex = paletteRows.length
    ? Math.min(paletteSelectedIndex, paletteRows.length - 1)
    : 0;
  const selectedRowKey = paletteRows[clampedSelectedIndex]?.key;

  const isRowSelected = (key: string) => selectedRowKey === key;
  const handleRowEnter = () => {
    paletteRows[clampedSelectedIndex]?.run();
  };

  // #112: mark the document for the native shell so macOS-only chrome
  // (window vibrancy, traffic-light inset, translucent sidebar) is applied
  // via CSS only under Tauri — the browser build stays visually identical.

  return {
    paletteQuery,
    setPaletteQuery,
    paletteSelectedIndex,
    setPaletteSelectedIndex,
    inputRef,
    activeSessionTab,
    activeSessionPane,
    focusSessionTab,
    matchingSections,
    matchingHosts,
    matchingSessionTabs,
    matchingSnippets,
    matchingActiveCommands,
    matchingRecent,
    paletteRows,
    clampedSelectedIndex,
    selectedRowKey,
    isRowSelected,
    handleRowEnter,
    focusHost,
    launchHostSession,
    openHostTransfers,
    manageHostTrust,
    focusSection,
    focusSession,
    runSnippetInActivePane,
  };
}
