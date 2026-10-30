// Shared connect-flow helper. Replaces the three near-identical
// markConnected + openSession + navigate call sites in HostsPage,
// AppShell, and Sidebar. Wedges the inline first-connect fingerprint
// prompt (P2-FP) into the path so the user resolves trust BEFORE the
// session tab is added — no orphaned cyan tabs when the user rejects.
//
// See docs/parity-and-hardening-plan.md P2-FP.

import { useHostsStore } from "../store/hosts-store";
import { useSessionsStore } from "../store/sessions-store";
import { useConnectErrorStore, type ConnectErrorTone } from "../store/connect-error-store";
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
    | "scan-empty"
    | "trust-scan-threw"
    | "user-non-interactive";
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

/**
 * Publish a connect failure to the app shell.
 *
 * Every connect entry point — the hosts page, quick-connect, the sidebar's
 * local/pinned/recent lists, the command palette, and the first-run welcome
 * panel — funnels through `launchHostSession`, so reporting here is what
 * guarantees a failure reaches the screen no matter where it was raised.
 * The call sites still log to the console for debugging; they no longer have
 * to duplicate the user-facing message.
 */
function reportFailure(message: string, tone: ConnectErrorTone = "error") {
  useConnectErrorStore.getState().setConnectError(message, tone);
}

async function launchHostSessionInner(host: HostRecord): Promise<LaunchHostSessionResult> {
  let trustResult: Awaited<ReturnType<typeof ensureTrustedHostKey>>;
  try {
    trustResult = await ensureTrustedHostKey(host);
  } catch (error) {
    // A throwing trust scan is still a connect failure. None of the call
    // sites have a try/catch, so without this it surfaced as an unhandled
    // rejection with nothing on screen. The detail stays in the console —
    // it can carry internals that do not belong in the UI.
    // The label is passed as its own argument, not interpolated into the
    // message: a host label is user-controlled and a format specifier in it
    // would forge the log line.
    console.warn("[connect] trust scan failed for host:", host.label, error);
    const message = `Could not reach ${host.hostname}:${host.port}. Check that the host is reachable and try again.`;
    reportFailure(message);
    return { ok: false, reason: "trust-scan-threw", errorMessage: message };
  }

  if (!trustResult.ok) {
    if (trustResult.reason === "user-rejected") {
      // The user chose to reject the key. That is not an error, so it is
      // reported as a warning rather than an error banner.
      const message = `Connection cancelled — host key for ${host.label} was not trusted.`;
      reportFailure(message, "warning");
      return { ok: false, reason: "user-rejected-fingerprint", errorMessage: message };
    }
    if (trustResult.reason === "scan-failed") {
      const message = `Could not scan ${host.hostname}:${host.port}. Check that the host is reachable and try again.`;
      reportFailure(message);
      return { ok: false, reason: "scan-failed", errorMessage: message };
    }
    if (trustResult.reason === "scan-empty") {
      const message = `${host.hostname}:${host.port} returned no host keys to trust.`;
      reportFailure(message);
      return { ok: false, reason: "scan-empty", errorMessage: message };
    }
    if (trustResult.reason === "user-non-interactive") {
      const message = `Could not prompt for the host key of ${host.label}. Open the host from the Hosts page to approve it.`;
      reportFailure(message);
      return { ok: false, reason: "user-non-interactive", errorMessage: message };
    }
    // Other reasons (policy-allows-unknown, etc.) shouldn't surface as
    // ok=false here because ensureTrustedHostKey returns ok=true for them.
    // Defensive fall-through.
    const message = `Connection cancelled.`;
    reportFailure(message, "warning");
    return { ok: false, reason: "user-non-interactive", errorMessage: message };
  }

  // A successful connect clears any previous failure so a stale banner
  // never outlives the problem it described.
  useConnectErrorStore.getState().clearConnectError();

  useHostsStore.getState().markConnected(host.id);
  const tabId = useSessionsStore.getState().openSession(host);
  return { ok: true, tabId };
}
