import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ConfirmDialog } from "../components/common/ConfirmDialog";
import { CopyKeyToHostDialog } from "../components/keys/CopyKeyToHostDialog";
import { KeyEditor } from "../components/keys/KeyEditor";
import { KeyList } from "../components/keys/KeyList";
import {
  copyKeyToHost,
  generatePrivateKey,
  importPrivateKeyFromBody,
  inspectPrivateKey,
  scanKnownHost,
} from "../lib/api";
import { validatePastedPrivateKey } from "../lib/private-key-validation";
import { useHostsStore } from "../store/hosts-store";
import { useKnownHostsStore } from "../store/known-hosts-store";
import { useKeysStore } from "../store/keys-store";
import type { GenerateKeyValues, ImportKeyValues } from "../types/key";

function deriveLabel(path: string) {
  return path.split("/").filter(Boolean).slice(-1)[0] ?? "Imported key";
}

export function KeysPage() {
  const [searchParams] = useSearchParams();
  const hosts = useHostsStore((state) => state.hosts);
  const assignKey = useHostsStore((state) => state.assignKey);
  const clearKeyByPath = useHostsStore((state) => state.clearKeyByPath);
  const keys = useKeysStore((state) => state.keys);
  const knownHosts = useKnownHostsStore((state) => state.knownHosts);
  const trustKnownHost = useKnownHostsStore((state) => state.trustKnownHost);
  const removeKnownHost = useKnownHostsStore((state) => state.removeKnownHost);
  const importKey = useKeysStore((state) => state.importKey);
  const addGeneratedKey = useKeysStore((state) => state.addGeneratedKey);
  const deleteKey = useKeysStore((state) => state.deleteKey);
  const assignHost = useKeysStore((state) => state.assignHost);
  const hostsById = useMemo(
    () => Object.fromEntries(hosts.map((host) => [host.id, host])),
    [hosts]
  );

  const [selectedKeyId, setSelectedKeyId] = useState<string>();
  const [assignHostId, setAssignHostId] = useState("");
  const [editorMode, setEditorMode] = useState<"import" | "generate">("import");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState<string>();
  const [deletePendingKeyId, setDeletePendingKeyId] = useState<string>();
  const [scanHostId, setScanHostId] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState<string>();
  const [scanResults, setScanResults] = useState<
    Awaited<ReturnType<typeof scanKnownHost>>["entries"]
  >([]);
  // T12: ssh-copy-id state.
  const [copyKeyId, setCopyKeyId] = useState<string | undefined>(undefined);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyError, setCopyError] = useState<string | undefined>(undefined);
  const [copySuccess, setCopySuccess] = useState<string | undefined>(undefined);

  const selectedKey = keys.find((key) => key.id === selectedKeyId) ?? keys[0];
  const resolvedAssignHostId = assignHostId || hosts[0]?.id || "";
  const resolvedScanHostId = scanHostId || hosts[0]?.id || "";
  const requestedScanHostId = searchParams.get("scanHost") ?? "";
  const autoScanRequested = searchParams.get("autoScan") === "1";
  const autoScanKeyRef = useRef<string | undefined>(undefined);

  const closeEditor = () => {
    setEditorOpen(false);
    setEditorError(undefined);
    setEditorBusy(false);
  };

  const handleImport = async (values: ImportKeyValues) => {
    setEditorBusy(true);
    setEditorError(undefined);

    try {
      const pasted = values.pastedKeyBody.trim();
      let metadata;
      if (pasted) {
        // T13: validate the body shape client-side before the
        // backend writes anything to disk.
        const validation = validatePastedPrivateKey(pasted);
        if (!validation.ok) {
          throw new Error(validation.reason ?? "Pasted key body is invalid.");
        }
        metadata = await importPrivateKeyFromBody({
          path: values.privateKeyPath.trim(),
          body: pasted,
        });
      } else {
        metadata = await inspectPrivateKey(values.privateKeyPath.trim());
      }
      const keyId = importKey(
        values.label.trim() || metadata.comment || deriveLabel(metadata.privateKeyPath),
        metadata,
        values.hasPassphrase
      );
      setSelectedKeyId(keyId);
      closeEditor();
    } catch (error) {
      setEditorBusy(false);
      setEditorError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleGenerate = async (values: GenerateKeyValues) => {
    setEditorBusy(true);
    setEditorError(undefined);

    try {
      const metadata = await generatePrivateKey({
        comment: values.comment.trim() || values.label.trim() || "termsnip@local",
        passphrase: values.passphrase,
        path: values.privateKeyPath.trim(),
        type: values.type,
      });
      const keyId = addGeneratedKey(
        values.label.trim() || metadata.comment || deriveLabel(metadata.privateKeyPath),
        metadata,
        Boolean(values.passphrase)
      );
      setSelectedKeyId(keyId);
      closeEditor();
    } catch (error) {
      setEditorBusy(false);
      setEditorError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDelete = () => {
    if (!deletePendingKeyId) {
      return;
    }

    const deletedKey = deleteKey(deletePendingKeyId);
    if (deletedKey) {
      clearKeyByPath(deletedKey.privateKeyPath);
    }
    setDeletePendingKeyId(undefined);
    if (selectedKeyId === deletePendingKeyId) {
      setSelectedKeyId(undefined);
    }
  };

  const runKnownHostScan = useCallback(async (hostId = resolvedScanHostId) => {
    const targetHost = hosts.find((host) => host.id === hostId);
    if (!targetHost) {
      return;
    }

    setScanBusy(true);
    setScanError(undefined);

    try {
      const result = await scanKnownHost(targetHost.hostname, targetHost.port);
      setScanResults(result.entries);
    } catch (error) {
      setScanResults([]);
      setScanError(error instanceof Error ? error.message : String(error));
    } finally {
      setScanBusy(false);
    }
  }, [hosts, resolvedScanHostId]);

  useEffect(() => {
    if (!requestedScanHostId) {
      return;
    }

    setScanHostId((current) => (current === requestedScanHostId ? current : requestedScanHostId));
  }, [requestedScanHostId]);

  useEffect(() => {
    if (!autoScanRequested || !requestedScanHostId) {
      return;
    }

    if (!hosts.some((host) => host.id === requestedScanHostId)) {
      return;
    }

    const autoScanKey = `${requestedScanHostId}:${autoScanRequested}`;
    if (autoScanKeyRef.current === autoScanKey) {
      return;
    }

    autoScanKeyRef.current = autoScanKey;
    void runKnownHostScan(requestedScanHostId);
  }, [autoScanRequested, hosts, requestedScanHostId, runKnownHostScan]);

  return (
    <>
      <section className="flex h-full min-h-0 flex-col gap-4">
        <div className="rounded-[22px] border border-slate-800/80 bg-slate-950/45 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-3xl text-sm leading-6 text-slate-400">
              {keys.length} keys • import existing identities, generate new ones locally, and keep
              passphrases out of the saved inventory
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditorMode("import");
                  setEditorOpen(true);
                }}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Import key
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditorMode("generate");
                  setEditorOpen(true);
                }}
                className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300"
              >
                Generate key
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex flex-1 flex-col gap-3">
          <div className="min-h-0 flex-1">
            <KeyList
              keys={keys}
              hosts={hostsById}
              selectedKeyId={selectedKey?.id}
              onSelect={setSelectedKeyId}
              onDelete={setDeletePendingKeyId}
              onCopyToHost={(keyId) => {
                setCopyKeyId(keyId);
                setCopyError(undefined);
                setCopySuccess(undefined);
              }}
              renderExpandedContent={(key) => (
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[18px] border border-slate-800 bg-slate-900/60 p-3 sm:col-span-2">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        Fingerprint
                      </p>
                      <p className="mt-2 break-all text-sm text-slate-100">{key.fingerprint}</p>
                    </div>
                    <div className="rounded-[18px] border border-slate-800 bg-slate-900/60 p-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        Metadata
                      </p>
                      <p className="mt-2 text-sm text-slate-100">
                        {key.algorithm} · {key.bits || "?"} bits · {key.source}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {key.comment} {key.hasPassphrase ? "· passphrase set" : ""}
                      </p>
                    </div>
                    <div className="rounded-[18px] border border-slate-800 bg-slate-900/60 p-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        Private key path
                      </p>
                      <p className="mt-2 break-all text-sm text-slate-100">{key.privateKeyPath}</p>
                    </div>
                  </div>

                  <div className="rounded-[18px] border border-slate-800 bg-slate-900/60 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                      Assign to host
                    </p>
                    <select
                      value={resolvedAssignHostId}
                      onChange={(event) => setAssignHostId(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
                    >
                      {hosts.map((host) => (
                        <option key={host.id} value={host.id}>
                          {host.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        if (!resolvedAssignHostId) {
                          return;
                        }

                        assignHost(key.id, resolvedAssignHostId);
                        assignKey(resolvedAssignHostId, {
                          label: key.label,
                          privateKeyPath: key.privateKeyPath,
                        });
                      }}
                      className="mt-3 w-full rounded-xl bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300"
                    >
                      Assign key
                    </button>
                  </div>
                </div>
              )}
            />
          </div>

          <section className="rounded-[22px] border border-slate-800/80 bg-slate-950/45 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                  Known hosts
                </p>
                <button
                  type="button"
                  onClick={() => void runKnownHostScan()}
                  disabled={!resolvedScanHostId || scanBusy}
                  className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {scanBusy ? "Scanning…" : "Scan"}
                </button>
              </div>

              <select
                value={resolvedScanHostId}
                onChange={(event) => setScanHostId(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
              >
                {hosts.map((host) => (
                  <option key={host.id} value={host.id}>
                    {host.label}
                  </option>
                ))}
              </select>

              {scanError ? (
                <div className="mt-2 rounded-[14px] border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                  {scanError}
                </div>
              ) : null}

              <div className="mt-2 space-y-2">
                {scanResults.map((entry) => (
                  <div
                    key={`${entry.hostname}:${entry.port}:${entry.algorithm}`}
                    className="rounded-[14px] border border-slate-800 bg-slate-950/60 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-slate-100">
                        {entry.hostname}:{entry.port}
                      </p>
                      <button
                        type="button"
                        onClick={() => trustKnownHost(entry)}
                        className="rounded-lg bg-emerald-400 px-2.5 py-1 text-[11px] font-medium text-slate-950 transition hover:bg-emerald-300"
                      >
                        Trust
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {entry.algorithm} · {entry.fingerprint}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-3 space-y-2">
                {knownHosts.length ? (
                  knownHosts.map((knownHost) => (
                    <div
                      key={knownHost.id}
                      className="rounded-[14px] border border-slate-800 bg-slate-950/60 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-slate-100">
                          {knownHost.hostname}:{knownHost.port}
                        </p>
                        <button
                          type="button"
                          onClick={() => removeKnownHost(knownHost.id)}
                          className="rounded-lg border border-rose-500/40 px-2.5 py-1 text-[11px] text-rose-200 transition hover:border-rose-400 hover:text-white"
                        >
                          Remove
                        </button>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {knownHost.algorithm} · {knownHost.fingerprint}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">
                    No trusted host keys stored yet.
                  </p>
                )}
              </div>
          </section>
        </div>
      </section>

      <KeyEditor
        key={`${editorMode}-${editorOpen ? "open" : "closed"}`}
        mode={editorMode}
        open={editorOpen}
        busy={editorBusy}
        errorMessage={editorError}
        onClose={closeEditor}
        onImport={handleImport}
        onGenerate={handleGenerate}
      />

      <ConfirmDialog
        open={Boolean(deletePendingKeyId)}
        title="Delete key record"
        description="Remove this key from the local inventory and clear any host assignments that point at it."
        confirmLabel="Delete"
        onCancel={() => setDeletePendingKeyId(undefined)}
        onConfirm={handleDelete}
      />

      <CopyKeyToHostDialog
        open={Boolean(copyKeyId)}
        keyRecord={keys.find((k) => k.id === copyKeyId)}
        hosts={hosts}
        busy={copyBusy}
        errorMessage={copyError}
        successMessage={copySuccess}
        onCancel={() => {
          setCopyKeyId(undefined);
          setCopyError(undefined);
          setCopySuccess(undefined);
        }}
        onConfirm={async (hostId) => {
          const keyRecord = keys.find((k) => k.id === copyKeyId);
          const host = hosts.find((h) => h.id === hostId);
          if (!keyRecord || !host) {
            return;
          }
          setCopyBusy(true);
          setCopyError(undefined);
          setCopySuccess(undefined);
          try {
            const result = await copyKeyToHost({
              privateKeyPath: keyRecord.privateKeyPath,
              host: {
                hostname: host.hostname,
                port: host.port,
                username: host.username,
                authMethod: host.authMethod,
                privateKeyPath: host.privateKeyPath,
                password: "",
                passphrase: "",
                hostKeyPolicy: host.hostKeyPolicy,
                agentForwarding: host.agentForwarding,
                protocol: host.protocol,
                environment: host.environment,
              },
            });
            if (result.ok) {
              setCopySuccess(`Installed key on ${host.label}.`);
            } else {
              setCopyError(result.reason ?? "Copy failed.");
            }
          } catch (error) {
            setCopyError(error instanceof Error ? error.message : String(error));
          } finally {
            setCopyBusy(false);
          }
        }}
      />
    </>
  );
}
