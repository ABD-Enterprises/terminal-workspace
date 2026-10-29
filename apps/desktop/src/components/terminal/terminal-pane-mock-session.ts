import { type MutableRefObject } from "react";
import { type Terminal } from "xterm";
import { buildMockCommandResponse, formatPrompt } from "../../lib/terminal";
import { type HostRecord } from "../../types/host";

export interface TerminalPaneMockSessionOptions {
  activeHistoryEntryIdRef: MutableRefObject<string | undefined>;
  appendCommandOutput: (historyEntryId: string, outputPreview: string) => void;
  commandBufferRef: MutableRefObject<string>;
  group: HostRecord["group"];
  hostname: HostRecord["hostname"];
  label: HostRecord["label"];
  port: HostRecord["port"];
  protocol: HostRecord["protocol"];
  sftpRoot: HostRecord["sftpRoot"];
  stableTags: HostRecord["tags"];
  terminal: Pick<Terminal, "clear" | "write" | "writeln">;
  username: HostRecord["username"];
}

export function createTerminalPaneMockSession({
  activeHistoryEntryIdRef,
  appendCommandOutput,
  commandBufferRef,
  group,
  hostname,
  label,
  port,
  protocol,
  sftpRoot,
  stableTags,
  terminal,
  username,
}: TerminalPaneMockSessionOptions) {
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
      if (responseLines.length > 0) {
        // The typed command is echoed with `terminal.write` and never
        // terminated, so the response must open its own line or it runs
        // onto the prompt. An empty response (blank Enter) must not gain
        // a blank line — `writeln` appends, it never prepends.
        terminal.write("\r\n");
        responseLines.forEach((line) => terminal.writeln(line));
      }
      outputPreview = responseLines.join("\n");
    }

    if (activeHistoryEntryIdRef.current && outputPreview) {
      appendCommandOutput(activeHistoryEntryIdRef.current, outputPreview);
    }
    activeHistoryEntryIdRef.current = undefined;
    writePrompt();
  };

  return { runMockCommand, writePrompt };
}
