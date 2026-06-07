// Shared connect-flow helper. Replaces the three near-identical
// markConnected + openSession + navigate call sites in HostsPage,
// AppShell, and Sidebar. Wedges the inline first-connect fingerprint
// prompt (P2-FP) into the path so the user resolves trust BEFORE the
// session tab is added — no orphaned cyan tabs when the user rejects.
//
// See docs/parity-and-hardening-plan.md P2-FP.

import { useHostsStore } from "../store/hosts-store";
import { useSessionsStore } from "../store/sessions-store";
import type { HostRecord } from "../types/host";
import { ensureTrustedHostKey } from "./ensure-trusted-host-key";

export interface LaunchHostSessionResult {
  ok: boolean;
  /** When ok=true, the new (or reused) session tab id. */
  tabId?: string;
  /** When ok=false, a short reason for the failure. */
  reason?:
    | "user-rejected-fingerprint"
    | "scan-failed"
    | "scan-empty";
  /** Human-readable error suitable for surfacing to the user. */
  errorMessage?: string;
}

// M07 / #89: per-host mutex. Double-tapping Open used to kick off two
// parallel trust-key scans + two trust prompts, each of which could
// write a duplicate entry to the known-hosts store. The mutex
// dedupes by host id — concurrent calls receive the same Promise as
// the first-in-flight call, and the map entry is cleared in finally
// so the next legitimate connect attempt isn't blocked.
const inFlight = new Map<string, Promise<LaunchHostSessionResult>>();

export async function launchHostSession(host: HostRecord): Promise<LaunchHostSessionResult> {
  const existing = inFlight.get(host.id);
  if (existing) {
    return existing;
  }
  const promise = launchHostSessionInner(host).finally(() => {
    inFlight.delete(host.id);
  });
  inFlight.set(host.id, promise);
  return promise;
}

async function launchHostSessionInner(host: HostRecord): Promise<LaunchHostSessionResult> {
  const trustResult = await ensureTrustedHostKey(host);
  if (!trustResult.ok) {
    if (trustResult.reason === "user-rejected") {
      return {
        ok: false,
        reason: "user-rejected-fingerprint",
        errorMessage: `Connection cancelled — host key for ${host.label} was not trusted.`,
      };
    }
    if (trustResult.reason === "scan-failed") {
      return {
        ok: false,
        reason: "scan-failed",
        errorMessage: `Could not scan ${host.hostname}:${host.port}. Check that the host is reachable and try again.`,
      };
    }
    if (trustResult.reason === "scan-empty") {
      return {
        ok: false,
        reason: "scan-empty",
        errorMessage: `${host.hostname}:${host.port} returned no host keys to trust.`,
      };
    }
    // Other reasons (policy-allows-unknown, etc.) shouldn't surface as ok=false
    // here because ensureTrustedHostKey returns ok=true for them. Defensive
    // fall-through.
    return {
      ok: false,
      errorMessage: `Connection cancelled.`,
    };
  }

  useHostsStore.getState().markConnected(host.id);
  const tabId = useSessionsStore.getState().openSession(host);
  return { ok: true, tabId };
}
