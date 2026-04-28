// Resolve the bound Identity for a host. The pure variant
// (`resolveHostIdentityFrom`) takes both stores' state directly so unit
// tests don't need the global zustand singletons. The store-reading variant
// (`resolveHostIdentity`) is what the runtime calls.
//
// Used by:
//   - connections.ts (P2-DM1 batch 3) to prefer identity-supplied
//     username / authMethod / privateKeyPath when building the
//     BackendHostConnection sent to ssh2 / native_transport.
//   - connection-secrets-store (P2-DM1 batch 3) to route Keychain
//     storage by identityId, replacing the per-fingerprint workaround
//     introduced by P1-S5.
//
// Returns undefined when the host has no `identityId` or the referenced
// record no longer exists. Callers fall back to the per-host fields in
// that case (transitional behaviour until P2-DM1 batch 4 removes the
// per-host duplicates).
//
// See docs/parity-and-hardening-plan.md P2-DM1.

import { useHostsStore } from "../store/hosts-store";
import { useIdentitiesStore } from "../store/identities-store";
import type { HostRecord } from "../types/host";
import type { IdentityRecord } from "../types/identity";

export function resolveHostIdentity(hostId: string): IdentityRecord | undefined {
  const host = useHostsStore.getState().hosts.find((entry) => entry.id === hostId);
  if (!host?.identityId) {
    return undefined;
  }
  return useIdentitiesStore
    .getState()
    .identities.find((entry) => entry.id === host.identityId);
}

export function resolveHostIdentityFrom(
  hostId: string,
  hosts: Pick<HostRecord, "id" | "identityId">[],
  identities: IdentityRecord[]
): IdentityRecord | undefined {
  const host = hosts.find((entry) => entry.id === hostId);
  if (!host?.identityId) {
    return undefined;
  }
  return identities.find((entry) => entry.id === host.identityId);
}

/**
 * Resolve the identity for a host record without going through the hosts
 * store — useful when the caller already has the host in hand (e.g. inside
 * the connection builder, which receives a Pick<HostRecord, ...>).
 */
export function resolveIdentityForHost(
  host: Pick<HostRecord, "identityId">,
  identities: IdentityRecord[]
): IdentityRecord | undefined {
  if (!host.identityId) {
    return undefined;
  }
  return identities.find((entry) => entry.id === host.identityId);
}
