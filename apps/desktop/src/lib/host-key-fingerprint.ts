// Resolve a host's private-key fingerprint from the keys store.
//
// The host record links to its key by file path (`host.privateKeyPath`),
// not by key id — this is a known data-model gap (see
// internal/parity-and-hardening-review.md §2.1). Until the Identity refactor
// (P2-DM1) lands we resolve at lookup time by matching paths in the
// keys store. This helper is the single place that does that lookup so
// Phase 2 can replace it with a real foreign key without changing every
// call site.
//
// Used by connection-secrets-store to decide whether a host's passphrase
// belongs in the per-host Keychain entry or the per-fingerprint one
// (P1-S5). Returns undefined when the host has no key path, or when the
// matching key has no fingerprint (older imports might).

import { useHostsStore } from "../store/hosts-store";
import { useKeysStore } from "../store/keys-store";
import type { KeyRecord } from "../types/key";

function selectKeyForHost(
  privateKeyPath: string,
  keys: KeyRecord[]
): KeyRecord | undefined {
  const trimmed = privateKeyPath.trim();
  if (!trimmed) {
    return undefined;
  }
  // Exact-path match first; we do not normalize `~` here because both the
  // host record and the key record store the path as the user entered it.
  // Mismatches surface as "no fingerprint" → fall back to per-host entry,
  // which is the safe behaviour.
  return keys.find((entry) => entry.privateKeyPath.trim() === trimmed);
}

export function resolveHostKeyFingerprint(hostId: string): string | undefined {
  const host = useHostsStore.getState().hosts.find((entry) => entry.id === hostId);
  if (!host || !host.privateKeyPath?.trim()) {
    return undefined;
  }
  const key = selectKeyForHost(host.privateKeyPath, useKeysStore.getState().keys);
  const fingerprint = key?.fingerprint?.trim();
  return fingerprint && fingerprint.includes(":") ? fingerprint : undefined;
}

/**
 * Pure variant for tests: callers supply both stores' state directly so
 * the helper does not need to read from the global Zustand singletons.
 */
export function resolveHostKeyFingerprintFrom(
  hostId: string,
  hosts: Array<{ id: string; privateKeyPath: string }>,
  keys: KeyRecord[]
): string | undefined {
  const host = hosts.find((entry) => entry.id === hostId);
  if (!host || !host.privateKeyPath?.trim()) {
    return undefined;
  }
  const key = selectKeyForHost(host.privateKeyPath, keys);
  const fingerprint = key?.fingerprint?.trim();
  return fingerprint && fingerprint.includes(":") ? fingerprint : undefined;
}
