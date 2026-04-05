import { formatHostAddress } from "./utils";
import { formatHostProtocol, type HostRecord } from "../types/host";

export function buildTerminalIntro(
  host: Pick<HostRecord, "hostname" | "label" | "port" | "protocol" | "username">,
  connected: boolean,
  {
    demoModeEnabled = false,
    nativeBridgeEnabled = false,
    unsupportedTransport = false,
  }: {
    demoModeEnabled?: boolean;
    nativeBridgeEnabled?: boolean;
    unsupportedTransport?: boolean;
  } = {}
) {
  const protocolLabel = formatHostProtocol(host.protocol);
  const stateLine = demoModeEnabled
    ? connected
      ? `${protocolLabel} demo transport ready.`
      : `${protocolLabel} demo transport standing by.`
    : unsupportedTransport
      ? `${protocolLabel} sessions are not executable in this build yet.`
    : connected
      ? nativeBridgeEnabled
        ? host.protocol === "localShell"
          ? "Local shell connected through the native shell bridge."
          : host.protocol === "serial"
            ? "Serial session connected through the native shell bridge."
            : host.protocol === "telnet"
              ? "Telnet session connected through the native shell bridge."
              : host.protocol === "mosh"
                ? "Mosh session connected through the native shell bridge."
          : `${protocolLabel} session connected through the native shell bridge.`
        : `${protocolLabel} session connected.`
      : nativeBridgeEnabled
        ? host.protocol === "localShell"
          ? "Native local shell bridge standing by."
          : host.protocol === "serial"
            ? "Native serial bridge standing by."
            : host.protocol === "telnet"
              ? "Native telnet bridge standing by."
              : host.protocol === "mosh"
                ? "Native mosh bridge standing by."
        : "Native session bridge standing by."
        : host.protocol === "localShell"
          ? "Local shell requires the native desktop runtime."
          : "Connecting to the local SSH backend...";

  const detailLine = demoModeEnabled
    ? "Demo mode keeps commands local while the UI remains fully interactive."
    : unsupportedTransport
      ? "This protocol can be inventoried now, but its transport implementation is scheduled for a later parity slice."
    : nativeBridgeEnabled
      ? host.protocol === "localShell"
        ? "The native bridge launches your macOS login shell locally and keeps the session off the network path."
        : host.protocol === "telnet"
          ? "Telnet I/O stays inside the native PTY bridge and avoids the browser transport path."
          : host.protocol === "serial"
            ? "Serial device I/O stays inside the native PTY bridge and uses the saved baud rate."
            : host.protocol === "mosh"
              ? "The native bridge launches the local mosh client and keeps its UDP session outside the browser transport path."
        : "SSH sessions, jump-host chains, terminal stream I/O, SFTP, forwards, and remote snippets route through the native shell bridge."
      : "Session lifecycle routes through the local backend while the browser UI stays decoupled from the transport.";

  return [
    "",
    `TermSnip session for ${host.label}`,
    formatHostAddress(host),
    stateLine,
    detailLine,
    "",
  ];
}

export function formatPrompt(host: Pick<HostRecord, "label" | "protocol" | "username">) {
  if (host.protocol === "localShell") {
    return `${host.label.toLowerCase().replace(/\s+/g, "-")} % `;
  }

  return `${host.username}@${host.label.toLowerCase().replace(/\s+/g, "-")} % `;
}

export function buildMockCommandResponse(
  command: string,
  host: Pick<
    HostRecord,
    "group" | "hostname" | "label" | "port" | "protocol" | "sftpRoot" | "tags" | "username"
  >
) {
  const trimmed = command.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed === "help") {
    return [
      "Available mock commands:",
      "  help    show available commands",
      "  host    show active host metadata",
      "  clear   clear the terminal viewport",
      "  status  show connection state",
    ];
  }

  if (trimmed === "host") {
    return [
      `label: ${host.label}`,
      `protocol: ${formatHostProtocol(host.protocol)}`,
      `address: ${formatHostAddress(host)}`,
      `group: ${host.group || "Ungrouped"}`,
      `tags: ${host.tags.join(", ") || "none"}`,
      `sftp root: ${host.sftpRoot || "not applicable"}`,
    ];
  }

  if (trimmed === "status") {
    return [
      "transport: mock",
      `runtime: ${formatHostProtocol(host.protocol)} demo transport active`,
      `time: ${new Date().toLocaleTimeString()}`,
    ];
  }

  return [
    `Executed locally in mock mode: ${trimmed}`,
    host.protocol === "localShell"
      ? "No native shell was opened in this surface."
      : `No remote command was sent to ${host.hostname}.`,
  ];
}
