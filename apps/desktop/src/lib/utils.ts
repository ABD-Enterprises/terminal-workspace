import { formatHostProtocol, type HostRecord } from "../types/host";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function splitCommaList(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

export function parseEnvironmentVariables(value: string) {
  return Object.fromEntries(
    value
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separatorIndex = entry.indexOf("=");
        if (separatorIndex === -1) {
          return [entry, ""];
        }

        const key = entry.slice(0, separatorIndex).trim();
        const nextValue = entry.slice(separatorIndex + 1).trim();
        return [key, nextValue];
      })
      .filter(([key]) => Boolean(key))
  );
}

export function formatEnvironmentVariables(environment: Record<string, string>) {
  return Object.entries(environment)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export function formatRelativeTime(isoString?: string) {
  if (!isoString) {
    return "Never";
  }

  const timestamp = new Date(isoString).getTime();
  const deltaSeconds = Math.round((timestamp - Date.now()) / 1000);

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
    ["second", 1],
  ];

  for (const [unit, seconds] of ranges) {
    if (Math.abs(deltaSeconds) >= seconds || unit === "second") {
      return formatter.format(Math.round(deltaSeconds / seconds), unit);
    }
  }

  return "Just now";
}

export function formatHostAddress(
  host: Pick<HostRecord, "hostname" | "port" | "protocol" | "username">
) {
  if (host.protocol === "localShell") {
    return "Native login shell";
  }

  if (host.protocol === "telnet") {
    return `telnet://${host.hostname}:${host.port}`;
  }

  if (host.protocol === "serial") {
    return `${host.hostname} · ${host.port} baud`;
  }

  if (host.protocol === "mosh") {
    return `${host.username}@${host.hostname}:${host.port} via mosh`;
  }

  return `${host.username}@${host.hostname}:${host.port}`;
}

export function describeHostRuntime(
  host: Pick<
    HostRecord,
    | "agentForwarding"
    | "authMethod"
    | "hostKeyPolicy"
    | "hostname"
    | "jumpHostId"
    | "port"
    | "protocol"
  >,
  jumpHostLabel?: string
) {
  if (host.protocol === "localShell") {
    return "Native macOS shell bridge";
  }

  if (host.protocol === "telnet") {
    return "Native telnet bridge";
  }

  if (host.protocol === "serial") {
    return `Native serial bridge · ${host.port} baud`;
  }

  if (host.protocol === "mosh") {
    return "Native mosh bridge";
  }

  return [
    host.authMethod === "privateKey"
      ? "Private key"
      : host.authMethod === "password"
        ? "Password"
        : "Auth unset",
    host.hostKeyPolicy === "requireTrusted" ? "Trusted key required" : "Unknown key allowed",
    jumpHostLabel ? `via ${jumpHostLabel}` : "",
    host.agentForwarding ? "agent" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatBytes(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let current = value / 1024;
  let unitIndex = 0;

  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }

  return `${current.toFixed(current >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatTimestamp(isoString?: string) {
  if (!isoString) {
    return "—";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoString));
}

export function buildHostSearchText(host: HostRecord) {
  return [
    host.label,
    host.protocol,
    formatHostProtocol(host.protocol),
    host.hostname,
    host.username,
    host.authMethod,
    host.privateKeyPath,
    host.group,
    host.tags.join(" "),
    host.note,
    host.keyLabel,
    host.jumpHostId,
    host.agentForwarding ? "agent forwarding agent forward" : "",
    Object.entries(host.environment)
      .map(([key, value]) => `${key} ${value}`)
      .join(" "),
  ]
    .join(" ")
    .toLowerCase();
}
