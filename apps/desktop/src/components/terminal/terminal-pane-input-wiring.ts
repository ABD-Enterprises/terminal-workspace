import { type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { type IDisposable, type Terminal } from "xterm";
import { type SessionSocketLike } from "../../lib/api";
import { type SessionConnectionState, type SessionTransport } from "../../types/session";

export interface TerminalContextMenuPosition {
  x: number;
  y: number;
}

type ClipboardTerminal = Pick<Terminal, "getSelection" | "paste">;

/**
 * #507: copy the terminal's selection, telling the user what happened. Every
 * failure is reported rather than swallowed, including a webview with no
 * clipboard API at all.
 */
export function copyTerminalSelection(terminal: ClipboardTerminal, notify: (message: string) => void) {
  const selection = terminal.getSelection();
  if (!selection) {
    return;
  }
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    notify("Clipboard isn't available in this window.");
    return;
  }
  navigator.clipboard.writeText(selection).then(
    () => notify("Copied"),
    () => notify("Couldn't copy: clipboard access was refused.")
  );
}

/** #507: paste the clipboard into the session, only when the user asked. */
export function pasteIntoTerminal(terminal: ClipboardTerminal, notify: (message: string) => void) {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    notify("Clipboard isn't available in this window.");
    return;
  }
  navigator.clipboard.readText().then(
    (text) => {
      if (text) {
        terminal.paste(text);
      }
    },
    () => notify("Couldn't paste: clipboard access was refused.")
  );
}

interface TerminalPaneInputWiringOptions {
  commandBufferRef: MutableRefObject<string>;
  connectionStateRef: MutableRefObject<SessionConnectionState>;
  container: HTMLDivElement;
  /** Show a short clipboard message to the user (#507). */
  notifyClipboard: (message: string) => void;
  /** Open the terminal's context menu at this position (#507). */
  requestContextMenu: (position: TerminalContextMenuPosition) => void;
  runMockCommand: (command: string) => void;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  socketRef: MutableRefObject<SessionSocketLike | null>;
  terminal: Terminal;
  transportRef: MutableRefObject<SessionTransport>;
}

interface TerminalPaneInputWiring {
  dataDisposable: IDisposable;
  selectionDisposable: IDisposable;
  contextMenuHandler: (event: MouseEvent) => void;
}

export function attachTerminalPaneInputWiring({
  commandBufferRef,
  connectionStateRef,
  container,
  notifyClipboard,
  requestContextMenu,
  runMockCommand,
  setSearchOpen,
  socketRef,
  terminal,
  transportRef,
}: TerminalPaneInputWiringOptions): TerminalPaneInputWiring {
  const selectionDisposable = terminal.onSelectionChange(() => {
    copyTerminalSelection(terminal, notifyClipboard);
  });

  // #507: right-click used to paste the clipboard straight into the live
  // shell. It now only opens a menu; nothing reaches the session unless the
  // user picks Paste.
  const contextMenuHandler = (event: MouseEvent) => {
    event.preventDefault();
    requestContextMenu({ x: event.clientX, y: event.clientY });
  };
  container.addEventListener("contextmenu", contextMenuHandler);

  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") {
      return true;
    }
    const isMeta = event.metaKey || event.ctrlKey;
    if (isMeta && (event.key === "f" || event.key === "F")) {
      event.preventDefault();
      setSearchOpen(true);
      return false;
    }
    return true;
  });

  const dataDisposable = terminal.onData((data) => {
    if (
      transportRef.current !== "mock" &&
      transportRef.current !== "unsupported" &&
      socketRef.current?.readyState === WebSocket.OPEN
    ) {
      socketRef.current.send(JSON.stringify({ type: "input", data }));
      return;
    }

    if (connectionStateRef.current !== "connected") {
      return;
    }

    if (data === "\r") {
      runMockCommand(commandBufferRef.current);
      return;
    }

    if (data === "\u007f") {
      if (commandBufferRef.current.length > 0) {
        commandBufferRef.current = commandBufferRef.current.slice(0, -1);
        terminal.write("\b \b");
      }
      return;
    }

    if (data >= " ") {
      commandBufferRef.current += data;
      terminal.write(data);
    }
  });

  return { contextMenuHandler, dataDisposable, selectionDisposable };
}
