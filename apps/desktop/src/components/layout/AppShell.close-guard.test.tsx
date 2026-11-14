// @vitest-environment happy-dom
//
// UX-3: the native shell vetoes a window close only while the shell's close
// guard has reported ready, and waits for an acknowledgement of each forwarded
// request. This renders the real AppShell against a fake Tauri runtime and
// asserts the handshake, so a renderer that is not mounted (or has been
// replaced by the top-level ErrorBoundary) cannot leave the native side
// believing someone is listening.
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCloseGuardStore, WINDOW_CLOSE_REQUESTED_EVENT } from "../../store/close-guard-store";

vi.mock("./Sidebar", () => ({ Sidebar: () => null }));
vi.mock("./CommandPaletteDialog", () => ({ CommandPaletteDialog: () => null }));
vi.mock("../common/FirstRunTour", () => ({ FirstRunTour: () => null }));
vi.mock("../common/KeyboardCheatsheet", () => ({ KeyboardCheatsheet: () => null }));
vi.mock("../common/UpdateAvailableBanner", () => ({ UpdateAvailableBanner: () => null }));
vi.mock("../terminal/SessionRestoreManager", () => ({ SessionRestoreManager: () => null }));
vi.mock("../../hooks/useAutoUpdateCheck", () => ({ useAutoUpdateCheck: () => undefined }));
vi.mock("../../hooks/useDockBadgeSync", () => ({ useDockBadgeSync: () => undefined }));

type Internals = {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  transformCallback: (callback: (event: unknown) => void) => number;
};

const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
  if (command === "plugin:event|listen") {
    const handlerId = args?.handler as number;
    listenerByEvent.set(args?.event as string, handlerId);
    return handlerId;
  }
  return undefined;
});
const callbacks = new Map<number, (event: unknown) => void>();
const listenerByEvent = new Map<string, number>();
let nextCallbackId = 1;

function emitFromNative(event: string, payload: unknown) {
  const handlerId = listenerByEvent.get(event);
  if (handlerId === undefined) {
    throw new Error(`no listener registered for ${event}`);
  }
  callbacks.get(handlerId)?.({ event, id: 0, payload });
}

function commandCalls(command: string) {
  return invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args);
}

describe("AppShell window close handshake", () => {
  beforeEach(() => {
    callbacks.clear();
    listenerByEvent.clear();
    nextCallbackId = 1;
    invoke.mockClear();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: (command: string, args?: Record<string, unknown>) => invoke(command, args),
      transformCallback: (callback: (event: unknown) => void) => {
        const id = nextCallbackId++;
        callbacks.set(id, callback);
        return id;
      },
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    } satisfies Internals & { metadata: unknown };
    (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => undefined,
    };
    useCloseGuardStore.setState({ pendingTabIds: [], windowClosePending: false });
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    delete (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__;
  });

  async function mountShell() {
    const { AppShell } = await import("./AppShell");
    return render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>
    );
  }

  it("reports ready once the close listener is registered", async () => {
    await mountShell();

    await waitFor(() =>
      expect(commandCalls("terminal_workspace_set_close_guard_ready")).toEqual([{ ready: true }])
    );
    expect(listenerByEvent.has(WINDOW_CLOSE_REQUESTED_EVENT)).toBe(true);
  });

  it("acknowledges a forwarded close request with its sequence number", async () => {
    await mountShell();
    await waitFor(() => expect(listenerByEvent.has(WINDOW_CLOSE_REQUESTED_EVENT)).toBe(true));

    emitFromNative(WINDOW_CLOSE_REQUESTED_EVENT, 7);

    await waitFor(() =>
      expect(commandCalls("terminal_workspace_ack_close_request")).toEqual([{ seq: 7 }])
    );
  });

  it("reports not ready when the shell unmounts", async () => {
    const view = await mountShell();
    await waitFor(() =>
      expect(commandCalls("terminal_workspace_set_close_guard_ready")).toEqual([{ ready: true }])
    );

    view.unmount();

    await waitFor(() =>
      expect(commandCalls("terminal_workspace_set_close_guard_ready")).toEqual([
        { ready: true },
        { ready: false },
      ])
    );
  });
});
