// Inline first-connect fingerprint UX (P2-FP). Wedged into the connect
// flow before `buildBackendConnection` runs so the user sees the host
// fingerprint and explicitly accepts/rejects it instead of getting an
// opaque "Trusted host key required" error and being told to navigate
// to the Keys page.
//
// See docs/parity-and-hardening-plan.md P2-FP and
// docs/parity-and-hardening-review.md §3.S-1 / §6.1.

import { scanKnownHost, type KnownHostScanResult } from "./api";
import { findKnownHostMatch } from "./connections";
import { useKnownHostsStore } from "../store/known-hosts-store";
import { requestFingerprintTrustPrompt } from "../store/fingerprint-trust-prompt-store";
import { hostSupportsTrustedKeys, type HostRecord } from "../types/host";

export interface EnsureTrustedHostKeyOptions {
  /** Skip the modal prompt — used by background restore, which never wants
   *  to surface a popup. Returns false instead when trust is missing. */
  interactive?: boolean;
}

export interface EnsureTrustedHostKeyResult {
  ok: boolean;
  /** Reason for failure, surfaced in error UIs. */
  reason?:
    | "policy-allows-unknown"
    | "protocol-does-not-need-trust"
    | "already-trusted"
    | "user-rejected"
    | "user-non-interactive"
    | "scan-failed"
    | "scan-empty";
  /** When `ok && reason !== "already-trusted"`, the key the user accepted. */
  trustedKey?: KnownHostScanResult;
}

/**
 * Decide whether `host` already has a trusted key, prompt the user to trust
 * one if not, and persist the choice. Returns ok=true when the connect
 * flow may proceed.
 *
 * Side effects: when the user approves, calls `useKnownHostsStore.trustKnownHost`
 * before returning so the next call (or the immediately-following
 * `buildBackendConnection` invocation) finds the entry.
 */
export async function ensureTrustedHostKey(
  host: HostRecord,
  options?: EnsureTrustedHostKeyOptions
): Promise<EnsureTrustedHostKeyResult> {
  if (!hostSupportsTrustedKeys(host.protocol)) {
    return { ok: true, reason: "protocol-does-not-need-trust" };
  }
  if (host.hostKeyPolicy !== "requireTrusted") {
    return { ok: true, reason: "policy-allows-unknown" };
  }

  const knownHosts = useKnownHostsStore.getState().knownHosts;
  const existing = findKnownHostMatch(knownHosts, host);
  if (existing) {
    return { ok: true, reason: "already-trusted" };
  }

  if (options?.interactive === false) {
    return { ok: false, reason: "user-non-interactive" };
  }

  // Scan the host. Failures surface as a non-throwing result the caller
  // can format. We do not auto-retry — the user can re-trigger by clicking
  // Open again.
  let candidates: KnownHostScanResult[];
  try {
    const response = await scanKnownHost(host.hostname, host.port);
    candidates = response.entries;
  } catch {
    return { ok: false, reason: "scan-failed" };
  }
  if (candidates.length === 0) {
    return { ok: false, reason: "scan-empty" };
  }

  const accepted = await requestFingerprintTrustPrompt({
    hostId: host.id,
    hostLabel: host.label,
    hostname: host.hostname,
    port: host.port,
    candidates,
  });
  if (!accepted) {
    return { ok: false, reason: "user-rejected" };
  }

  // Persist the trusted key before returning so the immediate follow-up
  // call to `buildBackendConnection` sees it.
  useKnownHostsStore.getState().trustKnownHost(accepted);

  return { ok: true, trustedKey: accepted };
}
