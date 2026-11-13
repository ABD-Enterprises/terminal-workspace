// UX-3: close guards for active file transfers.
//
// Closing a session tab (or the whole window) while an upload/download is
// still moving leaves a partial file behind with no warning. This store is
// the single decision point: every close surface funnels through it, it
// checks the transfers queue, closes unguarded tabs immediately, and parks
// guarded ones behind a ConfirmDialog rendered by CloseGuardDialog.
//
// The store holds *pending decisions*, never performs destructive work on
// its own — confirm/cancel are explicit user actions.

import { create } from "zustand";
import { isTauriRuntime } from "../lib/backend-runtime";
import { useSessionsStore } from "./sessions-store";
import { countActiveTransfers, useTransfersStore } from "./transfers-store";

export const WINDOW_CLOSE_REQUESTED_EVENT = "terminal_workspace://window-close-requested";

interface CloseGuardState {
  /** Tabs the user asked to close that still have active transfers. */
  pendingTabIds: string[];
  /** True while the window-close confirmation dialog is up. */
  windowClosePending: boolean;
  requestTabClose: (tabIds: string[]) => void;
  confirmTabClose: () => void;
  cancelTabClose: () => void;
  /**
   * Called when the native shell reports a window close request. Closes
   * immediately when nothing is transferring; otherwise parks the request
   * behind the confirmation dialog.
   */
  handleWindowCloseRequest: () => void;
  confirmWindowClose: () => void;
  cancelWindowClose: () => void;
}

// The native shell intercepts the main window's CloseRequested and only lets
// a close through when the renderer holds the one-shot token, so this invoke
// is what actually closes the window (see terminal_workspace_confirm_close_window).
async function closeMainWindow() {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("terminal_workspace_confirm_close_window");
  } catch (error) {
    // IPC unavailable (browser preview) — nothing to close natively.
    console.warn("[close-guard] could not close the main window:", error);
  }
}

export const useCloseGuardStore = create<CloseGuardState>()((set, get) => ({
  pendingTabIds: [],
  windowClosePending: false,

  requestTabClose: (tabIds) => {
    const { tabs, closeTab } = useSessionsStore.getState();
    const { queue } = useTransfersStore.getState();
    const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
    const guarded: string[] = [];
    const unguarded: string[] = [];

    for (const tabId of tabIds) {
      const tab = tabsById.get(tabId);
      if (tab && countActiveTransfers(queue, tab.hostId) > 0) {
        guarded.push(tabId);
      } else {
        unguarded.push(tabId);
      }
    }

    for (const tabId of unguarded) {
      closeTab(tabId);
    }

    if (guarded.length > 0) {
      set({ pendingTabIds: guarded });
    }
  },

  confirmTabClose: () => {
    const { closeTab } = useSessionsStore.getState();
    for (const tabId of get().pendingTabIds) {
      closeTab(tabId);
    }
    set({ pendingTabIds: [] });
  },

  cancelTabClose: () => set({ pendingTabIds: [] }),

  handleWindowCloseRequest: () => {
    const { queue } = useTransfersStore.getState();
    if (countActiveTransfers(queue) > 0) {
      set({ windowClosePending: true });
      return;
    }
    void closeMainWindow();
  },

  confirmWindowClose: () => {
    set({ windowClosePending: false });
    void closeMainWindow();
  },

  cancelWindowClose: () => set({ windowClosePending: false }),
}));
