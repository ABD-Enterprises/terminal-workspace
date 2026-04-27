// Helper for the Identity manager UI: count and list the hosts that
// reference each identity. Pure, accepts plain arrays so the same logic
// drives the Settings panel ("Used by 3 hosts") and the delete-confirm
// dialog ("Move 3 hosts to a different identity first?").
//
// This is the only place that resolves "host → identity" outside of the
// connection-secrets flow today. When P2-DM1 batch 3 lands, the runtime
// will use a similar resolver but indexed by id (not by path); this helper
// keeps a focused identity-id semantic so it doesn't have to change.
//
// See docs/parity-and-hardening-plan.md P2-DM1.

import type { HostRecord } from "../types/host";

export interface IdentityUsage {
  identityId: string;
  hostIds: string[];
}

/**
 * Group hosts by their `identityId`. Hosts without one are excluded — they
 * have no identity to consume.
 */
export function buildIdentityUsage(hosts: HostRecord[]): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  for (const host of hosts) {
    const identityId = host.identityId?.trim();
    if (!identityId) {
      continue;
    }
    const existing = usage.get(identityId);
    if (existing) {
      existing.push(host.id);
    } else {
      usage.set(identityId, [host.id]);
    }
  }
  return usage;
}

export function countHostsUsingIdentity(
  hosts: HostRecord[],
  identityId: string
): number {
  if (!identityId) {
    return 0;
  }
  let count = 0;
  for (const host of hosts) {
    if (host.identityId === identityId) {
      count += 1;
    }
  }
  return count;
}

export function listHostsUsingIdentity(
  hosts: HostRecord[],
  identityId: string
): HostRecord[] {
  if (!identityId) {
    return [];
  }
  return hosts.filter((host) => host.identityId === identityId);
}
