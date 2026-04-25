import type { HostFormValues } from "../types/host";
import { emptyHostFormValues } from "../types/host";

export function parseSshConfig(content: string): Partial<HostFormValues>[] {
  const hosts: Partial<HostFormValues>[] = [];
  let currentHost: Partial<HostFormValues> | null = null;

  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z0-9_-]+)\s*=?\s*(.+)$/);
    if (!match) continue;

    const key = match[1].toLowerCase();
    const value = match[2];

    if (key === "host") {
      if (currentHost) {
        hosts.push(currentHost);
      }
      
      // Skip wildcard hosts for now
      if (value.includes("*") || value.includes("?")) {
        currentHost = null;
        continue;
      }

      currentHost = {
        ...emptyHostFormValues,
        label: value,
        hostname: value,
      };
    } else if (currentHost) {
      if (key === "hostname") {
        currentHost.hostname = value;
      } else if (key === "user") {
        currentHost.username = value;
      } else if (key === "port") {
        currentHost.port = value;
      } else if (key === "identityfile") {
        currentHost.privateKeyPath = value.replace(/^~/, "");
        currentHost.authMethod = "privateKey";
      }
    }
  }

  if (currentHost) {
    hosts.push(currentHost);
  }

  return hosts;
}
