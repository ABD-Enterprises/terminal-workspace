import type { KnownHostScanResult } from "../lib/api";
import { createSingleFlightPromptStore } from "./single-flight-prompt-store";

// Cross-component request bus for the inline first-connect fingerprint
// prompt (P2-FP). Mirrors the shape of `connection-secret-prompt-store`
// so the renderer has one consistent "wait for the user to approve
// something during connect" pattern.
//
// Why a store instead of a useState in TerminalPane: the trust prompt
// must surface even when the user clicks "Open" from the Hosts page —
// no terminal pane exists yet at that moment. The shared store lets a
// single `<FingerprintTrustPrompt />` mounted high in the tree handle
// every call site.
//
// See docs/parity-and-hardening-plan.md P2-FP and review §3.S-1 / §6.1.

export interface FingerprintTrustPromptRequest {
  hostId: string;
  hostLabel: string;
  hostname: string;
  port: number;
  /**
   * The key candidates `ssh-keyscan` returned. Usually 1–3 entries (one
   * per algorithm: ed25519, rsa, ecdsa). The user picks one to trust.
   */
  candidates: KnownHostScanResult[];
}

function getPromptKey(request: FingerprintTrustPromptRequest) {
  return [request.hostId, request.hostname, request.port].join(":");
}

export const useFingerprintTrustPromptStore =
  createSingleFlightPromptStore<FingerprintTrustPromptRequest, KnownHostScanResult | null>({
    busyResult: null,
    getPromptKey,
  });

export function requestFingerprintTrustPrompt(
  request: FingerprintTrustPromptRequest
) {
  return useFingerprintTrustPromptStore.getState().openPrompt(request);
}
