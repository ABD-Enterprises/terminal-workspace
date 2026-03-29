import { useMemo } from "react";
import { useHostsStore } from "../store/hosts-store";
import { useSessionsStore } from "../store/sessions-store";

export function useSessions() {
  const tabs = useSessionsStore((state) => state.tabs);
  const panes = useSessionsStore((state) => state.panes);
  const activeTabId = useSessionsStore((state) => state.activeTabId);
  const hosts = useHostsStore((state) => state.hosts);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs]
  );

  const activePanes = useMemo(
    () => activeTab?.paneIds.map((paneId) => panes[paneId]).filter(Boolean) ?? [],
    [activeTab, panes]
  );

  const hostById = useMemo(
    () => Object.fromEntries(hosts.map((host) => [host.id, host])),
    [hosts]
  );

  return {
    tabs,
    panes,
    hosts: hostById,
    activeTab,
    activePanes,
  };
}
