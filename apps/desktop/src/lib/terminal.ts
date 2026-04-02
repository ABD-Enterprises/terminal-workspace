import type { HostRecord } from "../types/host";

export function buildTerminalIntro(
  host: Pick<HostRecord, "hostname" | "label" | "port" | "username">,
  connected: boolean,
  {
    demoModeEnabled = false,
    nativeBridgeEnabled = false,
  }: {
    demoModeEnabled?: boolean;
    nativeBridgeEnabled?: boolean;
  } = {}
) {
  const stateLine = demoModeEnabled
    ? connected
      ? "Demo transport ready."
      : "Demo transport standing by."
    : connected
      ? nativeBridgeEnabled
        ? "SSH session connected through the native shell bridge."
        : "SSH session connected."
      : nativeBridgeEnabled
        ? "Native session bridge standing by."
        : "Connecting to the local SSH backend...";

  const detailLine = demoModeEnabled
    ? "Demo mode keeps commands local while the UI remains fully interactive."
    : nativeBridgeEnabled
      ? "Session lifecycle now routes through Tauri while terminal data still streams over the backend socket."
      : "Session lifecycle routes through the local backend while the browser UI stays decoupled from the transport.";

  return [
    "",
    `TermSnip session for ${host.label}`,
    `${host.username}@${host.hostname}:${host.port}`,
    stateLine,
    detailLine,
    "",
  ];
}

export function formatPrompt(host: Pick<HostRecord, "label" | "username">) {
  return `${host.username}@${host.label.toLowerCase().replace(/\s+/g, "-")} % `;
}

export function buildMockCommandResponse(
  command: string,
  host: Pick<HostRecord, "group" | "hostname" | "label" | "port" | "sftpRoot" | "tags" | "username">
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
      `address: ${host.username}@${host.hostname}:${host.port}`,
      `group: ${host.group || "Ungrouped"}`,
      `tags: ${host.tags.join(", ") || "none"}`,
      `sftp root: ${host.sftpRoot}`,
    ];
  }

  if (trimmed === "status") {
    return [
      "transport: mock",
      "ssh backend: pending tauri/rust implementation",
      `time: ${new Date().toLocaleTimeString()}`,
    ];
  }

  return [
    `Executed locally in mock mode: ${trimmed}`,
    `No remote command was sent to ${host.hostname}.`,
  ];
}
