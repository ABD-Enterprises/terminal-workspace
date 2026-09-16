import { describe, expect, it, vi } from "vitest";
import { cleanupTerminalPaneLifecycle } from "./terminal-pane-cleanup";

const g = globalThis as unknown as Record<string, unknown>;
g.window = g;

function ref<T>(current: T) {
  return { current };
}

describe("cleanupTerminalPaneLifecycle", () => {
  it("disposes terminal resources and clears reconnect state", () => {
    const clearReconnectTimer = vi.fn();
    const socket = { close: vi.fn() };
    const terminalRef = ref({ dispose: vi.fn(), _core: { viewport: { _refreshAnimationFrame: null } } });
    const fitAddonRef = ref({
      activate: vi.fn(),
      dispose: vi.fn(),
      fit: vi.fn(),
      proposeDimensions: vi.fn(),
    });

    cleanupTerminalPaneLifecycle({
      clearReconnectTimer,
      container: { removeEventListener: vi.fn() } as unknown as HTMLDivElement,
      contextMenuHandler: vi.fn(),
      dataDisposable: { dispose: vi.fn() },
      fitAddon: fitAddonRef.current as never,
      fitAddonRef: fitAddonRef as never,
      fitFrameId: null,
      markDisposed: vi.fn(),
      observer: { disconnect: vi.fn() } as unknown as ResizeObserver,
      selectionDisposable: { dispose: vi.fn() },
      socketRef: ref(socket) as never,
      terminal: terminalRef.current as never,
      terminalRef: terminalRef as never,
    });

    expect(clearReconnectTimer).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledOnce();
    expect(terminalRef.current).toBeNull();
    expect(fitAddonRef.current).toBeNull();
  });
});
