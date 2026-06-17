import { create } from "zustand";
import type { KnownHostScanResult } from "../lib/api";

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
// See internal/parity-and-hardening-plan.md P2-FP and review §3.S-1 / §6.1.

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

interface FingerprintTrustPromptState {
  pendingRequest?: FingerprintTrustPromptRequest;
  resolveRequest?: (accepted: KnownHostScanResult | null) => void;
  openPrompt: (
    request: FingerprintTrustPromptRequest
  ) => Promise<KnownHostScanResult | null>;
  clearPrompt: (accepted: KnownHostScanResult | null) => void;
}

let activePromptKey: string | undefined;
let activePromptPromise: Promise<KnownHostScanResult | null> | undefined;

function getPromptKey(request: FingerprintTrustPromptRequest) {
  return [request.hostId, request.hostname, request.port].join(":");
}

export const useFingerprintTrustPromptStore = create<FingerprintTrustPromptState>(
  (set, get) => ({
    pendingRequest: undefined,
    resolveRequest: undefined,
    openPrompt: async (request) => {
      const promptKey = getPromptKey(request);

      if (activePromptPromise && activePromptKey === promptKey) {
        return activePromptPromise;
      }

      if (activePromptPromise) {
        // A different prompt is already pending — refuse rather than
        // queue. The caller can retry once the user has resolved the
        // current one. Avoids stacking modals.
        return null;
      }

      activePromptKey = promptKey;
      activePromptPromise = new Promise<KnownHostScanResult | null>((resolve) => {
        set({
          pendingRequest: request,
          resolveRequest: (accepted) => resolve(accepted),
        });
      });

      const result = await activePromptPromise;
      activePromptKey = undefined;
      activePromptPromise = undefined;
      return result;
    },
    clearPrompt: (accepted) => {
      get().resolveRequest?.(accepted);
      set({
        pendingRequest: undefined,
        resolveRequest: undefined,
      });
    },
  })
);

export function requestFingerprintTrustPrompt(
  request: FingerprintTrustPromptRequest
) {
  return useFingerprintTrustPromptStore.getState().openPrompt(request);
}
