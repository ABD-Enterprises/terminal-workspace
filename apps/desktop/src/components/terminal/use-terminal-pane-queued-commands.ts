import { useEffect, type MutableRefObject } from "react";
import { type SessionPane } from "../../types/session";
import { type SessionSocketLike } from "../../lib/api";

export function isQueuedCommandTransportPending(pane: Pick<SessionPane, "transport">, socket: SessionSocketLike | null) {
  return (
    pane.transport !== "mock" &&
    pane.transport !== "unsupported" &&
    socket?.readyState !== WebSocket.OPEN
  );
}

interface UseTerminalPaneQueuedCommandsOptions {
  consumePaneCommand: (paneId: string, commandId: string) => void;
  dispatchCommandRef: MutableRefObject<(command: string) => void>;
  ensureConnectedRef: MutableRefObject<() => void>;
  pane: SessionPane;
  processedCommandIdRef: MutableRefObject<string | undefined>;
  socketRef: MutableRefObject<SessionSocketLike | null>;
}

export function useTerminalPaneQueuedCommands({
  consumePaneCommand,
  dispatchCommandRef,
  ensureConnectedRef,
  pane,
  processedCommandIdRef,
  socketRef,
}: UseTerminalPaneQueuedCommandsOptions) {
  useEffect(() => {
    const queuedCommand = pane.queuedCommands[0];

    if (!queuedCommand) {
      processedCommandIdRef.current = undefined;
      return;
    }

    if (processedCommandIdRef.current === queuedCommand.id) {
      return;
    }

    const sshTransportPending = isQueuedCommandTransportPending(pane, socketRef.current);

    if (pane.connectionState !== "connected" || sshTransportPending) {
      ensureConnectedRef.current();
      return;
    }

    processedCommandIdRef.current = queuedCommand.id;
    dispatchCommandRef.current(queuedCommand.command);
    consumePaneCommand(pane.id, queuedCommand.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dependency array preserved verbatim from useTerminalPaneSession.
  }, [consumePaneCommand, pane.connectionState, pane.id, pane.queuedCommands, pane.transport]);
}
