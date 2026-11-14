import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionTab } from "../types/session";
import type { TransferItem } from "../types/transfer";
import { useCloseGuardStore } from "./close-guard-store";
import { useSessionsStore } from "./sessions-store";
import { useTransfersStore } from "./transfers-store";

function tab(id: string, hostId: string): SessionTab {
  return {
    id,
    title: hostId,
    hostId,
    paneIds: ["p1"],
    activePaneId: "p1",
    splitDirection: "vertical",
    createdAt: "2026-11-13T00:00:00.000Z",
    updatedAt: "2026-11-13T00:00:00.000Z",
  };
}

function transfer(id: string, hostId: string, status: TransferItem["status"]): TransferItem {
  return {
    id,
    hostId,
    hostLabel: hostId,
    direction: "download",
    name: `${id}.bin`,
    remotePath: `/tmp/${id}.bin`,
    status,
    createdAt: "2026-11-13T00:00:00.000Z",
    updatedAt: "2026-11-13T00:00:00.000Z",
  };
}

describe("close-guard-store", () => {
  beforeEach(() => {
    useCloseGuardStore.setState({ pendingTabIds: [], windowClosePending: false });
    useSessionsStore.setState({ tabs: [], activeTabId: undefined });
    useTransfersStore.setState({ queue: [] });
  });

  it("closes tabs immediately when nothing is transferring", () => {
    const closeTab = vi.fn();
    useSessionsStore.setState({
      tabs: [tab("t1", "h1"), tab("t2", "h2")],
      closeTab,
    });

    useCloseGuardStore.getState().requestTabClose(["t1", "t2"]);

    expect(closeTab).toHaveBeenCalledWith("t1");
    expect(closeTab).toHaveBeenCalledWith("t2");
    expect(useCloseGuardStore.getState().pendingTabIds).toEqual([]);
  });

  it("parks only the guarded tabs and closes the rest", () => {
    const closeTab = vi.fn();
    useSessionsStore.setState({
      tabs: [tab("t1", "h1"), tab("t2", "h2")],
      closeTab,
    });
    useTransfersStore.setState({ queue: [transfer("x1", "h1", "running")] });

    useCloseGuardStore.getState().requestTabClose(["t1", "t2"]);

    expect(closeTab).toHaveBeenCalledTimes(1);
    expect(closeTab).toHaveBeenCalledWith("t2");
    expect(useCloseGuardStore.getState().pendingTabIds).toEqual(["t1"]);
  });

  it("confirm closes the pending tabs; cancel leaves them open", () => {
    const closeTab = vi.fn();
    useSessionsStore.setState({
      tabs: [tab("t1", "h1")],
      closeTab,
    });
    useTransfersStore.setState({ queue: [transfer("x1", "h1", "queued")] });
    useCloseGuardStore.getState().requestTabClose(["t1"]);
    expect(useCloseGuardStore.getState().pendingTabIds).toEqual(["t1"]);

    useCloseGuardStore.getState().cancelTabClose();
    expect(closeTab).not.toHaveBeenCalled();
    expect(useCloseGuardStore.getState().pendingTabIds).toEqual([]);

    useCloseGuardStore.getState().requestTabClose(["t1"]);
    useCloseGuardStore.getState().confirmTabClose();
    expect(closeTab).toHaveBeenCalledWith("t1");
    expect(useCloseGuardStore.getState().pendingTabIds).toEqual([]);
  });

  it("treats completed transfers as no longer blocking", () => {
    const closeTab = vi.fn();
    useSessionsStore.setState({ tabs: [tab("t1", "h1")], closeTab });
    useTransfersStore.setState({ queue: [transfer("x1", "h1", "completed")] });

    useCloseGuardStore.getState().requestTabClose(["t1"]);

    expect(closeTab).toHaveBeenCalledWith("t1");
    expect(useCloseGuardStore.getState().pendingTabIds).toEqual([]);
  });

  it("parks the window close request while any transfer is active", () => {
    useTransfersStore.setState({ queue: [transfer("x1", "h1", "running")] });

    useCloseGuardStore.getState().handleWindowCloseRequest();
    expect(useCloseGuardStore.getState().windowClosePending).toBe(true);

    useCloseGuardStore.getState().cancelWindowClose();
    expect(useCloseGuardStore.getState().windowClosePending).toBe(false);
  });

  it("closes the window directly when no transfers are active", () => {
    // Non-Tauri test env: closeMainWindow short-circuits, so the observable
    // contract is simply that no dialog is parked.
    useCloseGuardStore.getState().handleWindowCloseRequest();
    expect(useCloseGuardStore.getState().windowClosePending).toBe(false);
  });
});
