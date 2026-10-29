import { beforeEach, describe, expect, it } from "vitest";
import { sampleHosts } from "../types/host";
import { openSessionWorkspace, useSessionsStore } from "../store/sessions-store";
import { useHostsStore } from "../store/hosts-store";
import { dispatchCommandToActivePane } from "./active-pane-dispatch";

describe("#454 dispatchCommandToActivePane", () => {
  beforeEach(() => {
    useSessionsStore.setState({ tabs: [], panes: {}, activeTabId: undefined });
    useHostsStore.setState({ hosts: sampleHosts });
  });

  it("#454: queues the command on the active pane and marks the host connected", () => {
    const opened = openSessionWorkspace(
      { tabs: [], panes: {}, activeTabId: undefined, lastRestoredAt: undefined },
      sampleHosts[0]
    );
    useSessionsStore.setState(opened);

    expect(dispatchCommandToActivePane("uptime", "Nightly")).toBe(true);

    const paneId = useSessionsStore.getState().tabs[0]?.activePaneId ?? "";
    const queued = useSessionsStore.getState().panes[paneId]?.queuedCommands ?? [];
    expect(queued).toHaveLength(1);
    expect(queued[0]?.command).toBe("uptime");
    expect(queued[0]?.label).toBe("Nightly");
    expect(
      useHostsStore.getState().hosts.find((host) => host.id === sampleHosts[0]?.id)
        ?.lastConnectedAt
    ).toBeTruthy();
  });

  it("#454: returns false when no session pane is active", () => {
    expect(dispatchCommandToActivePane("uptime", "Nightly")).toBe(false);
  });
});
