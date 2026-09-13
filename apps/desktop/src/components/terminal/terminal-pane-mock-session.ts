import { type MutableRefObject } from "react";
import { Terminal } from "xterm";
import { buildMockCommandResponse, formatPrompt } from "../../lib/terminal";
import { type HostRecord } from "../../types/host";
import { type SessionConnectionState, type SessionTransport } from "../../types/session";

interface TerminalPaneMockSessionOptions {
  activeHistoryEntryIdRef: MutableRefObject<string | undefined>;
  appendCommandOutput: (historyEntryId: string, outputPreview: string) => void;
  commandBufferRef: MutableRefObject<string>;
  connectionStateRef: MutableRefObject<SessionConnectionState>;
  group: HostRecord["group"];
  hostname: HostRecord["hostname"];
  intentionalDisconnectRef: MutableRefObject<boolean>;
  label: HostRecord["label"];
  paneId: string;
  port: HostRecord["port"];
  protocol: HostRecord["protocol"];
  reconnectOnRestoreRef: MutableRefObject<boolean>;
  reconnectTimeoutRef: MutableRefObject<number | null>;
  setPaneReconnectOnRestore: (paneId: string, reconnectOnRestore: boolean) => void;
  setPaneState: (paneId: string, connectionState: SessionConnectionState) => void;
  setPaneTransport: (paneId: string, transport: SessionTransport) => void;
  sftpRoot: HostRecord["sftpRoot"];
  stableTags: HostRecord["tags"];
  terminal: Terminal;
  transportRef: MutableRefObject<SessionTransport>;
  username: HostRecord["username"];
}

export interface TerminalPaneMockSession {
  dispatchMockCommand: (command: string, recordCommand: () => string | undefined) => void;
  runMockCommand: (command: string) => void;
  toggleMockConnection: () => void;
  writePrompt: () => void;
}

export function createTerminalPaneMockSession({
  activeHistoryEntryIdRef,
  appendCommandOutput,
  commandBufferRef,
  connectionStateRef,
  group,
  hostname,
  intentionalDisconnectRef,
  label,
  paneId,
  port,
  protocol,
  reconnectOnRestoreRef,
  reconnectTimeoutRef,
  setPaneReconnectOnRestore,
  setPaneState,
  setPaneTransport,
  sftpRoot,
  stableTags,
  terminal,
  transportRef,
  username,
}: TerminalPaneMockSessionOptions): TerminalPaneMockSession {
  const writePrompt = () => {
    const prompt = formatPrompt({ label, protocol, username });
    commandBufferRef.current = "";
    terminal.write(`\r\n${prompt}`);
  };

  const runMockCommand = (command: string) => {
    let outputPreview = "";
    if (command.trim() === "clear") {
      terminal.clear();
    } else {
      const responseLines = buildMockCommandResponse(command, {
        group,
        hostname,
        label,
        port,
        protocol,
        sftpRoot,
        tags: stableTags,
        username,
      });
      responseLines.forEach((line) => terminal.writeln(line));
      outputPreview = responseLines.join("\n");
    }

    if (activeHistoryEntryIdRef.current && outputPreview) {
      appendCommandOutput(activeHistoryEntryIdRef.current, outputPreview);
    }
    activeHistoryEntryIdRef.current = undefined;
    writePrompt();
  };

  const toggleMockConnection = () => {
    transportRef.current = "mock";
    setPaneTransport(paneId, "mock");

    if (connectionStateRef.current === "connected") {
      intentionalDisconnectRef.current = true;
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      connectionStateRef.current = "disconnected";
      reconnectOnRestoreRef.current = false;
      setPaneReconnectOnRestore(paneId, false);
      setPaneState(paneId, "disconnected");
      terminal.writeln("\r\nMock session disconnected.");
    } else {
      connectionStateRef.current = "connected";
      setPaneState(paneId, "connected");
      terminal.writeln(
        protocol === "localShell"
          ? "\r\nLocal shell demo session connected."
          : "\r\nMock session connected."
      );
      writePrompt();
    }
  };

  const dispatchMockCommand = (command: string, recordCommand: () => string | undefined) => {
    const trimmedCommand = command.trim();

    if (!trimmedCommand) {
      writePrompt();
      return;
    }

    activeHistoryEntryIdRef.current = recordCommand();

    if (connectionStateRef.current !== "connected") {
      return;
    }

    terminal.write(trimmedCommand);
    commandBufferRef.current = trimmedCommand;
    runMockCommand(trimmedCommand);
  };

  return { dispatchMockCommand, runMockCommand, toggleMockConnection, writePrompt };
}
