// Modal that surfaces the host-key fingerprint inline during the connect
// flow (P2-FP). Replaces the "navigate to /keys, scan, trust, navigate
// back" dance the review (§3.S-1, §6.1) called out as Termius's worst
// onboarding cliff.
//
// Multiple key candidates (one per algorithm — ed25519 / rsa / ecdsa) are
// shown together so the user can pick. The default selection is the first
// entry which is typically ed25519 (returned first by ssh-keyscan when
// available).

import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  type FingerprintTrustPromptRequest,
  useFingerprintTrustPromptStore,
} from "../../store/fingerprint-trust-prompt-store";
import { Modal } from "./Modal";

function FingerprintTrustPromptForm({ pendingRequest }: { pendingRequest: FingerprintTrustPromptRequest }) {
  const clearPrompt = useFingerprintTrustPromptStore((state) => state.clearPrompt);
  const [selectedAlgorithm, setSelectedAlgorithm] = useState<string>(
    () => pendingRequest.candidates[0]?.algorithm ?? ""
  );
  const selected = pendingRequest.candidates.find(
    (entry) => entry.algorithm === selectedAlgorithm
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!selected) {
          return;
        }
        clearPrompt(selected);
      }}
    >
      <p className="text-sm leading-6 text-slate-300">
        First connection to{" "}
        <code className="rounded bg-slate-900 px-1 py-0.5 text-slate-100">
          {pendingRequest.hostname}:{pendingRequest.port}
        </code>
        . Verify the fingerprint matches what the host operator has published
        before trusting. Future connections will reject this host until you
        scan and trust it again.
      </p>

      <fieldset className="mt-4 space-y-2">
        {pendingRequest.candidates.map((candidate) => {
          const checked = candidate.algorithm === selectedAlgorithm;
          return (
            <label
              key={candidate.algorithm}
              className={`flex cursor-pointer flex-col gap-1 rounded-2xl border px-4 py-3 transition ${
                checked
                  ? "border-emerald-400/60 bg-emerald-400/10"
                  : "border-slate-800 bg-slate-950/60 hover:border-slate-600"
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="trust-key"
                  value={candidate.algorithm}
                  checked={checked}
                  onChange={() => setSelectedAlgorithm(candidate.algorithm)}
                  className="h-4 w-4 accent-emerald-400"
                />
                <span className="text-sm font-medium text-slate-100">
                  {candidate.algorithm}
                </span>
              </span>
              <code className="block break-all text-xs text-slate-300">
                {candidate.fingerprint}
              </code>
            </label>
          );
        })}
      </fieldset>

      <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm leading-6 text-amber-100">
        Trusting a key here is equivalent to scanning and trusting the host
        in the Keys workspace. Reject if the fingerprint does not match the
        operator's published value — the connection will not proceed.
      </div>

      <div className="mt-6 border-t border-slate-800 pt-5">
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => clearPrompt(null)}
            className="rounded-2xl border border-rose-500/40 px-4 py-2 text-sm text-rose-100 transition hover:border-rose-400 hover:text-white"
          >
            Reject
          </button>
          <button
            type="submit"
            disabled={!selected}
            className="rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            Trust this key
          </button>
        </div>
      </div>
    </form>
  );
}

export function FingerprintTrustPrompt() {
  const location = useLocation();
  const pendingRequest = useFingerprintTrustPromptStore((state) => state.pendingRequest);
  const clearPrompt = useFingerprintTrustPromptStore((state) => state.clearPrompt);

  // If the user navigates away mid-prompt, treat it as a rejection so
  // pending callers don't stay deadlocked. Mirrors the
  // ConnectionSecretPrompt's behaviour.
  useEffect(() => {
    if (!pendingRequest) {
      return;
    }
    return () => {
      clearPrompt(null);
    };
  }, [clearPrompt, location.pathname, pendingRequest]);

  return (
    <Modal
      open={Boolean(pendingRequest)}
      title={pendingRequest ? `Trust ${pendingRequest.hostLabel}?` : "Trust host key"}
      description={
        pendingRequest
          ? `Pick the algorithm to trust. The fingerprint must match the value the host operator has published.`
          : undefined
      }
      onClose={() => clearPrompt(null)}
      className="max-w-xl"
    >
      {pendingRequest ? (
        <FingerprintTrustPromptForm
          key={`${pendingRequest.hostId}:${pendingRequest.port}`}
          pendingRequest={pendingRequest}
        />
      ) : null}
    </Modal>
  );
}
