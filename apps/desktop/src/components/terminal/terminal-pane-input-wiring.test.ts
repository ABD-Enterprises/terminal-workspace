import { describe, expect, it, vi } from "vitest";
import { attachTerminalPaneInputWiring } from "./terminal-pane-input-wiring";

const g = globalThis as unknown as Record<string, unknown>;
g.WebSocket = { OPEN: 1 };

function ref<T>(current: T) {
  return { current };
}

function createTerminal() {
  let dataHandler: ((data: string) => void) | undefined;
  let keyHandler: ((event: KeyboardEvent) => boolean) | undefined;
  const writes: string[] = [];
  return {
    terminal: {
      attachCustomKeyEventHandler: vi.fn((handler: (event: KeyboardEvent) => boolean) => {
        keyHandler = handler;
      }),
      getSelection: vi.fn(() => ""),
      onData: vi.fn((handler: (data: string) => void) => {
        dataHandler = handler;
        return { dispose: vi.fn() };
      }),
      onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
      paste: vi.fn(),
      write: vi.fn((value: string) => writes.push(value)),
    },
    emitData: (data: string) => dataHandler?.(data),
    emitKey: (event: KeyboardEvent) => keyHandler?.(event),
    writes,
  };
}

describe("attachTerminalPaneInputWiring", () => {
  it("forwards data to native sockets and edits mock command input", () => {
    const send = vi.fn();
    const container = {
      addEventListener: vi.fn(),
    } as unknown as HTMLDivElement;
    const runMockCommand = vi.fn();
    const { emitData, terminal, writes } = createTerminal();
    const commandBufferRef = ref("");
    const connectionStateRef = ref<"connected" | "disconnected">("connected");
    const socketRef = ref({ addEventListener: vi.fn(), close: vi.fn(), readyState: 1, send });
    const transportRef = ref<"ssh" | "mock">("ssh");

    attachTerminalPaneInputWiring({
      commandBufferRef,
      connectionStateRef,
      container,
      runMockCommand,
      setSearchOpen: vi.fn(),
      socketRef,
      terminal: terminal as never,
      transportRef,
    });

    emitData("x");
    expect(send).toHaveBeenCalledWith(JSON.stringify({ type: "input", data: "x" }));

    transportRef.current = "mock";
    emitData("a");
    emitData("b");
    emitData("\u007f");
    emitData("\r");

    expect(commandBufferRef.current).toBe("a");
    expect(writes).toEqual(["a", "b", "\b \b"]);
    expect(runMockCommand).toHaveBeenCalledWith("a");
  });
});
