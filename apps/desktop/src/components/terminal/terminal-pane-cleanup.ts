import { type FitAddon } from "@xterm/addon-fit";
import { type MutableRefObject } from "react";
import { type IDisposable, type Terminal } from "xterm";
import { type SessionSocketLike } from "../../lib/api";
import { clearViewportRefreshFrame, getPrivateViewport } from "./terminal-pane-viewport";

export interface TerminalPaneCleanupOptions {
  clearReconnectTimer: () => void;
  container: HTMLDivElement;
  contextMenuHandler: (event: MouseEvent) => void;
  dataDisposable: IDisposable;
  fitAddon: FitAddon;
  fitAddonRef: MutableRefObject<FitAddon | null>;
  fitFrameId: number | null;
  markDisposed: () => void;
  observer: ResizeObserver;
  selectionDisposable: IDisposable;
  socketRef: MutableRefObject<SessionSocketLike | null>;
  terminal: Terminal;
  terminalRef: MutableRefObject<Terminal | null>;
}

export function cleanupTerminalPaneLifecycle({
  clearReconnectTimer,
  container,
  contextMenuHandler,
  dataDisposable,
  fitAddon,
  fitAddonRef,
  fitFrameId,
  markDisposed,
  observer,
  selectionDisposable,
  socketRef,
  terminal,
  terminalRef,
}: TerminalPaneCleanupOptions) {
  markDisposed();
  observer.disconnect();
  dataDisposable.dispose();
  selectionDisposable.dispose();
  container.removeEventListener("contextmenu", contextMenuHandler);
  if (fitFrameId !== null) {
    window.cancelAnimationFrame(fitFrameId);
  }
  clearReconnectTimer();
  socketRef.current?.close();
  socketRef.current = null;
  clearViewportRefreshFrame(getPrivateViewport(terminal));
  fitAddon.dispose();
  terminal.dispose();
  terminalRef.current = null;
  fitAddonRef.current = null;
}
