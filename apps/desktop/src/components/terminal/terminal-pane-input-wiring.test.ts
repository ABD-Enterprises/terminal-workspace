import { describe, expect, it, vi } from "vitest";
import {
  attachTerminalPaneInputWiring,
  copyTerminalSelection,
  pasteIntoTerminal,
} from "./terminal-pane-input-wiring";

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
      notifyClipboard: vi.fn(),
      requestContextMenu: vi.fn(),
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

  it("#507: right-click opens the menu and sends nothing to the session", async () => {
    const send = vi.fn();
    let contextMenuListener: ((event: MouseEvent) => void) | undefined;
    const container = {
      addEventListener: vi.fn((type: string, listener: (event: MouseEvent) => void) => {
        if (type === "contextmenu") {
          contextMenuListener = listener;
        }
      }),
    } as unknown as HTMLDivElement;
    const readText = vi.fn(async () => "rm -rf ~\r");
    vi.stubGlobal("navigator", { clipboard: { readText, writeText: vi.fn() } });
    const requestContextMenu = vi.fn();
    const { terminal } = createTerminal();

    attachTerminalPaneInputWiring({
      commandBufferRef: ref(""),
      connectionStateRef: ref<"connected" | "disconnected">("connected"),
      container,
      notifyClipboard: vi.fn(),
      requestContextMenu,
      runMockCommand: vi.fn(),
      setSearchOpen: vi.fn(),
      socketRef: ref({ addEventListener: vi.fn(), close: vi.fn(), readyState: 1, send }),
      terminal: terminal as never,
      transportRef: ref<"ssh" | "mock">("ssh"),
    });

    const preventDefault = vi.fn();
    contextMenuListener?.({ clientX: 40, clientY: 70, preventDefault } as unknown as MouseEvent);
    await Promise.resolve();

    expect(preventDefault).toHaveBeenCalled();
    expect(requestContextMenu).toHaveBeenCalledWith({ x: 40, y: 70 });
    expect(readText).not.toHaveBeenCalled();
    expect(terminal.paste).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("#507: clipboard actions report what happened", () => {
  function clipboardTerminal(selection = "") {
    return { getSelection: vi.fn(() => selection), paste: vi.fn() };
  }

  it("Paste writes the clipboard to the terminal", async () => {
    vi.stubGlobal("navigator", { clipboard: { readText: vi.fn(async () => "ls\r") } });
    const terminal = clipboardTerminal();
    const notify = vi.fn();
    pasteIntoTerminal(terminal, notify);
    await vi.waitFor(() => expect(terminal.paste).toHaveBeenCalledWith("ls\r"));
    expect(notify).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("a refused paste is reported, not swallowed", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { readText: vi.fn(async () => Promise.reject(new Error("denied"))) },
    });
    const terminal = clipboardTerminal();
    const notify = vi.fn();
    pasteIntoTerminal(terminal, notify);
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Couldn't paste: clipboard access was refused.")
    );
    expect(terminal.paste).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("a webview with no clipboard API is reported for paste and copy", () => {
    vi.stubGlobal("navigator", {});
    const notify = vi.fn();
    pasteIntoTerminal(clipboardTerminal(), notify);
    copyTerminalSelection(clipboardTerminal("text"), notify);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith("Clipboard isn't available in this window.");
    vi.unstubAllGlobals();
  });

  it("Copy reports success and refusal, and does nothing with no selection", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const notify = vi.fn();
    copyTerminalSelection(clipboardTerminal(""), notify);
    expect(writeText).not.toHaveBeenCalled();

    copyTerminalSelection(clipboardTerminal("hello"), notify);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith("Copied"));
    expect(writeText).toHaveBeenCalledWith("hello");

    writeText.mockImplementationOnce(async () => Promise.reject(new Error("denied")));
    copyTerminalSelection(clipboardTerminal("again"), notify);
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Couldn't copy: clipboard access was refused.")
    );
    vi.unstubAllGlobals();
  });
});
