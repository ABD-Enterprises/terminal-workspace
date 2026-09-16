import { type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { type IDisposable, type Terminal } from "xterm";
import { type SessionSocketLike } from "../../lib/api";
import { type SessionConnectionState, type SessionTransport } from "../../types/session";

export interface TerminalPaneInputWiringOptions {
  commandBufferRef: MutableRefObject<string>;
  connectionStateRef: MutableRefObject<SessionConnectionState>;
  container: HTMLDivElement;
  runMockCommand: (command: string) => void;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  socketRef: MutableRefObject<SessionSocketLike | null>;
  terminal: Terminal;
  transportRef: MutableRefObject<SessionTransport>;
}

export interface TerminalPaneInputWiring {
  dataDisposable: IDisposable;
  selectionDisposable: IDisposable;
  contextMenuHandler: (event: MouseEvent) => void;
}

export function attachTerminalPaneInputWiring({
  commandBufferRef,
  connectionStateRef,
  container,
  runMockCommand,
  setSearchOpen,
  socketRef,
  terminal,
  transportRef,
}: TerminalPaneInputWiringOptions): TerminalPaneInputWiring {
  const selectionDisposable = terminal.onSelectionChange(() => {
    const selection = terminal.getSelection();
    if (!selection) {
      return;
    }
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    navigator.clipboard.writeText(selection).catch(() => {});
  });

  const contextMenuHandler = (event: MouseEvent) => {
    event.preventDefault();
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    navigator.clipboard
      .readText()
      .then((text) => {
        if (!text) {
          return;
        }
        terminal.paste(text);
      })
      .catch(() => {});
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
