import { useRef, useState } from "react";
import { parseVaultSyncTrustPolicy, type VaultSyncTrustedKey } from "../lib/vault-sync-contract";
import { cn, splitCommaList } from "../lib/utils";
import { useVaultSyncTrustStore } from "../store/vault-sync-trust-store";

interface TrustedKeyDraft {
  originalKeyId: string | null;
  keyId: string;
  validFrom: string;
  rotateAfter: string;
  retireAfter: string;
  allowedVaultIds: string;
  replacementKeyIds: string;
}

const emptyTrustedKeyDraft: TrustedKeyDraft = {
  originalKeyId: null,
  keyId: "",
  validFrom: "",
  rotateAfter: "",
  retireAfter: "",
  allowedVaultIds: "",
  replacementKeyIds: "",
};


interface SettingsTrustPolicySectionProps {
  setStatusMessage: (message: string | undefined) => void;
  setErrorMessage: (message: string | undefined) => void;
}

export function SettingsTrustPolicySection({
  setStatusMessage,
  setErrorMessage,
}: SettingsTrustPolicySectionProps) {
  const trustPolicyFileInputRef = useRef<HTMLInputElement>(null);
  const trustPolicy = useVaultSyncTrustStore((state) => state.policy);
  const setAllowUnknownKeys = useVaultSyncTrustStore((state) => state.setAllowUnknownKeys);
  const upsertTrustedKey = useVaultSyncTrustStore((state) => state.upsertTrustedKey);
  const removeTrustedKey = useVaultSyncTrustStore((state) => state.removeTrustedKey);
  const replacePolicy = useVaultSyncTrustStore((state) => state.replacePolicy);
  const [trustedKeyDraft, setTrustedKeyDraft] = useState<TrustedKeyDraft>(emptyTrustedKeyDraft);

  const exportTrustPolicy = () => {
    const blob = new Blob([JSON.stringify(trustPolicy, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "termsnip-sync-trust-policy.json";
    anchor.click();
    URL.revokeObjectURL(url);

    setErrorMessage(undefined);
    setStatusMessage(`Exported ${trustPolicy.trustedKeys.length} trusted sync key records.`);
  };

  const importTrustPolicy = async (file?: File | null) => {
    if (!file) {
      return;
    }

    try {
      const policy = parseVaultSyncTrustPolicy(JSON.parse(await file.text()));
      replacePolicy(policy);
      setErrorMessage(undefined);
      setStatusMessage(
        `Imported ${policy.trustedKeys.length} trusted sync key records${policy.allowUnknownKeys ? " with unknown keys allowed." : "."}`
      );
    } catch (error) {
      setStatusMessage(undefined);
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (trustPolicyFileInputRef.current) {
        trustPolicyFileInputRef.current.value = "";
      }
    }
  };

  const submitTrustedKey = () => {
    const keyId = trustedKeyDraft.keyId.trim();
    const validFrom = trustedKeyDraft.validFrom.trim();
    const rotateAfter = trustedKeyDraft.rotateAfter.trim();
    const retireAfter = trustedKeyDraft.retireAfter.trim();

    if (!keyId || !validFrom) {
      setStatusMessage(undefined);
      setErrorMessage("Trusted sync keys require a key ID and valid-from timestamp.");
      return;
    }

    if (rotateAfter && rotateAfter < validFrom) {
      setStatusMessage(undefined);
      setErrorMessage("Rotation cannot start before the key becomes valid.");
      return;
    }

    if (retireAfter && retireAfter < validFrom) {
      setStatusMessage(undefined);
      setErrorMessage("Retirement cannot happen before the key becomes valid.");
      return;
    }

    upsertTrustedKey({
      keyId,
      algorithm: "AES-256-GCM",
      validFrom,
      rotateAfter: rotateAfter || null,
      retireAfter: retireAfter || null,
      allowedVaultIds: splitCommaList(trustedKeyDraft.allowedVaultIds).length
        ? splitCommaList(trustedKeyDraft.allowedVaultIds)
        : null,
      replacementKeyIds: splitCommaList(trustedKeyDraft.replacementKeyIds),
    });
    setTrustedKeyDraft(emptyTrustedKeyDraft);
    setErrorMessage(undefined);
    setStatusMessage(
      `${trustedKeyDraft.originalKeyId ? "Updated" : "Added"} trusted sync key ${keyId}.`
    );
  };

  const editTrustedKey = (key: VaultSyncTrustedKey) => {
    setTrustedKeyDraft({
      originalKeyId: key.keyId,
      keyId: key.keyId,
      validFrom: key.validFrom,
      rotateAfter: key.rotateAfter ?? "",
      retireAfter: key.retireAfter ?? "",
      allowedVaultIds: key.allowedVaultIds?.join(", ") ?? "",
      replacementKeyIds: key.replacementKeyIds.join(", "),
    });
    setErrorMessage(undefined);
  };


  return (
        <div className="rounded-[22px] border border-slate-800/80 bg-slate-950/45 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                Remote sync trust policy
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                Bootstrap and manage the trusted key IDs that can wrap remote vault snapshots. The
                policy stays local, can be exported for bootstrap distribution, and is loaded
                automatically before remote envelopes are accepted.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={exportTrustPolicy}
                className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300"
              >
                Export trust policy
              </button>
              <button
                type="button"
                onClick={() => trustPolicyFileInputRef.current?.click()}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Import trust policy
              </button>
            </div>
          </div>

          <input
            ref={trustPolicyFileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(event) => {
              void importTrustPolicy(event.target.files?.[0] ?? null);
            }}
          />

          <div className="mt-3 grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                    Trust enforcement
                  </p>
                  <p className="mt-1 text-sm text-slate-300">
                    {trustPolicy.allowUnknownKeys
                      ? "Unknown envelope keys are allowed."
                      : "Only explicitly trusted envelope keys are allowed."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAllowUnknownKeys(!trustPolicy.allowUnknownKeys)}
                  className={cn(
                    "rounded-[14px] border px-3 py-2 text-sm transition",
                    trustPolicy.allowUnknownKeys
                      ? "border-amber-400/50 bg-amber-400/10 text-amber-100"
                      : "border-slate-800 bg-slate-950/70 text-slate-300 hover:border-slate-700 hover:text-white"
                  )}
                >
                  {trustPolicy.allowUnknownKeys ? "Allow unknown keys" : "Require trusted keys"}
                </button>
              </div>

              <div className="mt-3 space-y-2">
                {trustPolicy.trustedKeys.length ? (
                  trustPolicy.trustedKeys.map((key) => (
                    <div
                      key={key.keyId}
                      className="rounded-[14px] border border-slate-800 bg-slate-950/60 p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-100">{key.keyId}</p>
                          <p className="text-xs leading-5 text-slate-400">
                            Valid from {key.validFrom}
                            {key.rotateAfter ? ` • Rotate after ${key.rotateAfter}` : ""}
                            {key.retireAfter ? ` • Retire after ${key.retireAfter}` : ""}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-slate-500">
                            Vaults {key.allowedVaultIds?.join(", ") ?? "all"} • Replacements{" "}
                            {key.replacementKeyIds.length ? key.replacementKeyIds.join(", ") : "none"}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => editTrustedKey(key)}
                            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              removeTrustedKey(key.keyId);
                              if (trustedKeyDraft.originalKeyId === key.keyId) {
                                setTrustedKeyDraft(emptyTrustedKeyDraft);
                              }
                              setErrorMessage(undefined);
                              setStatusMessage(`Removed trusted sync key ${key.keyId}.`);
                            }}
                            className="rounded-lg border border-rose-500/50 px-3 py-1.5 text-xs text-rose-200 transition hover:border-rose-400 hover:text-white"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[14px] border border-dashed border-slate-800 bg-slate-950/50 px-3 py-4 text-sm text-slate-400">
                    No trusted sync keys are configured yet.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                Trusted key editor
              </p>
              <div className="mt-3 grid gap-2">
                <label className="grid gap-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                  Key ID
                  <input
                    value={trustedKeyDraft.keyId}
                    onChange={(event) =>
                      setTrustedKeyDraft((current) => ({ ...current, keyId: event.target.value }))
                    }
                    className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none transition focus:border-emerald-400/50"
                    placeholder="wrap-key-1"
                  />
                </label>
                <label className="grid gap-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                  Valid from (ISO-8601)
                  <input
                    value={trustedKeyDraft.validFrom}
                    onChange={(event) =>
                      setTrustedKeyDraft((current) => ({ ...current, validFrom: event.target.value }))
                    }
                    className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none transition focus:border-emerald-400/50"
                    placeholder="2026-04-01T00:00:00.000Z"
                  />
                </label>
                <div className="grid gap-2 md:grid-cols-2">
                  <label className="grid gap-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                    Rotate after
                    <input
                      value={trustedKeyDraft.rotateAfter}
                      onChange={(event) =>
                        setTrustedKeyDraft((current) => ({ ...current, rotateAfter: event.target.value }))
                      }
                      className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none transition focus:border-emerald-400/50"
                      placeholder="2026-05-01T00:00:00.000Z"
                    />
                  </label>
                  <label className="grid gap-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                    Retire after
                    <input
                      value={trustedKeyDraft.retireAfter}
                      onChange={(event) =>
                        setTrustedKeyDraft((current) => ({ ...current, retireAfter: event.target.value }))
                      }
                      className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none transition focus:border-emerald-400/50"
                      placeholder="2026-06-01T00:00:00.000Z"
                    />
                  </label>
                </div>
                <label className="grid gap-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                  Allowed vault IDs
                  <input
                    value={trustedKeyDraft.allowedVaultIds}
                    onChange={(event) =>
                      setTrustedKeyDraft((current) => ({
                        ...current,
                        allowedVaultIds: event.target.value,
                      }))
                    }
                    className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none transition focus:border-emerald-400/50"
                    placeholder="vault-a, vault-b"
                  />
                </label>
                <label className="grid gap-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                  Replacement key IDs
                  <input
                    value={trustedKeyDraft.replacementKeyIds}
                    onChange={(event) =>
                      setTrustedKeyDraft((current) => ({
                        ...current,
                        replacementKeyIds: event.target.value,
                      }))
                    }
                    className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none transition focus:border-emerald-400/50"
                    placeholder="wrap-key-2, wrap-key-3"
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={submitTrustedKey}
                  className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300"
                >
                  {trustedKeyDraft.originalKeyId ? "Update key" : "Add key"}
                </button>
                <button
                  type="button"
                  onClick={() => setTrustedKeyDraft(emptyTrustedKeyDraft)}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
                >
                  Reset form
                </button>
              </div>
            </div>
          </div>
        </div>
  );
}
