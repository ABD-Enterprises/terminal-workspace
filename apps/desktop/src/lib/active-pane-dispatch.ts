import { useHostsStore } from "../store/hosts-store";
import { useSessionsStore } from "../store/sessions-store";

/**
 * #454: the one place that puts a command into the pane the person is
 * looking at. Every surface that can run a command — the command palette,
 * the snippets page, the runbooks page — goes through this helper, so the
 * "which pane is active" rule lives in exactly one file.
 *
 * Returns false when there is no active pane. In that case nothing is queued
 * and no host is marked connected.
 */
export function dispatchCommandToActivePane(command: string, label?: string): boolean {
  const sessions = useSessionsStore.getState();
  const activeTab = sessions.tabs.find((tab) => tab.id === sessions.activeTabId);

  if (!activeTab) {
    return false;
  }

  const pane = sessions.panes[activeTab.activePaneId];

  if (!pane) {
    return false;
  }

  useSessionsStore.getState().queuePaneCommand(pane.id, command, label);
  useHostsStore.getState().markConnected(pane.hostId);

  return true;
}
