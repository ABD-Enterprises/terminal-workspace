import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createRemoteDirectory,
  deleteRemoteEntry,
  downloadRemoteFile,
  listRemoteDirectory,
  renameRemoteEntry,
  uploadRemoteFile,
} from "../../lib/api";
import { buildBackendConnection } from "../../lib/connections";
import { ensureRuntimeSecrets } from "../../lib/runtime-secrets";
import { formatBytes } from "../../lib/utils";
import { useKnownHostsStore } from "../../store/known-hosts-store";
import { useTransfersStore } from "../../store/transfers-store";
import type { HostRecord } from "../../types/host";
import type { RemoteFileEntry } from "../../types/transfer";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { Modal } from "../common/Modal";
import { FileList } from "./FileList";

type DraftActionMode = "folder" | "rename";

interface DraftActionState {
  mode: DraftActionMode;
  value: string;
}

interface FileBrowserProps {
  host: HostRecord;
}

function getParentPath(path: string) {
  if (path === "/") {
    return "/";
  }

  const segments = path.split("/").filter(Boolean);
  segments.pop();
  return segments.length ? `/${segments.join("/")}` : "/";
}

function joinRemotePath(basePath: string, childName: string) {
  const normalizedChild = childName.trim().replace(/^\/+/, "");
  if (!normalizedChild) {
    return basePath;
  }

  return basePath === "/" ? `/${normalizedChild}` : `${basePath.replace(/\/+$/, "")}/${normalizedChild}`;
}

function promptLabels(mode: DraftActionMode) {
  if (mode === "folder") {
    return {
      title: "Create remote folder",
      description: "Add a new directory inside the current remote path.",
      placeholder: "Folder name",
      action: "Create folder",
    };
  }

  return {
    title: "Rename remote entry",
    description: "Update the selected remote file or folder name.",
    placeholder: "New name",
    action: "Rename",
  };
}

export function FileBrowser({ host }: FileBrowserProps) {
  const knownHosts = useKnownHostsStore((state) => state.knownHosts);
  const queueTransfer = useTransfersStore((state) => state.queueTransfer);
  const markTransferRunning = useTransfersStore((state) => state.markTransferRunning);
  const completeTransfer = useTransfersStore((state) => state.completeTransfer);
  const failTransfer = useTransfersStore((state) => state.failTransfer);
  const rememberRemotePath = useTransfersStore((state) => state.rememberRemotePath);
  const remotePathByHost = useTransfersStore((state) => state.remotePathByHost);

  const currentPath = remotePathByHost[host.id] ?? host.sftpRoot ?? "/";
  const [draftPath, setDraftPath] = useState(currentPath);
  const [search, setSearch] = useState("");
  const [entries, setEntries] = useState<RemoteFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [selectedEntry, setSelectedEntry] = useState<RemoteFileEntry>();
  const [draftAction, setDraftAction] = useState<DraftActionState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RemoteFileEntry>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDirectory = useCallback(async (targetPath: string) => {
    setLoading(true);
    setErrorMessage(undefined);

    try {
      const readyForConnection = await ensureRuntimeSecrets(host, "Browse remote files");
      if (!readyForConnection) {
        setEntries([]);
        setSelectedEntry(undefined);
        return;
      }

      const result = await listRemoteDirectory(buildBackendConnection(host, knownHosts), targetPath);
      rememberRemotePath(host.id, result.path);
      setEntries(result.entries);
      setSelectedEntry((current) =>
        current ? result.entries.find((entry) => entry.path === current.path) : undefined
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [host, knownHosts, rememberRemotePath]);

  useEffect(() => {
    if (!remotePathByHost[host.id] && host.sftpRoot) {
      rememberRemotePath(host.id, host.sftpRoot);
    }
  }, [host.id, host.sftpRoot, rememberRemotePath, remotePathByHost]);

  useEffect(() => {
    setDraftPath(currentPath);
  }, [currentPath]);

  useEffect(() => {
    void loadDirectory(currentPath);
  }, [currentPath, loadDirectory]);

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return entries;
    }

    return entries.filter((entry) => `${entry.name} ${entry.path}`.toLowerCase().includes(query));
  }, [entries, search]);

  const selectedPath = selectedEntry?.path;
  const canDownload = selectedEntry?.kind === "file";
  const canRename = Boolean(selectedEntry);
  const canDelete = Boolean(selectedEntry);

  const runTransfer = async (
    values: Parameters<typeof queueTransfer>[0],
    action: () => Promise<void>
  ) => {
    const transferId = queueTransfer(values);
    markTransferRunning(transferId);

    try {
      await action();
      completeTransfer(transferId);
    } catch (error) {
      failTransfer(transferId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  };

  const submitDraftAction = async () => {
    if (!draftAction) {
      return;
    }

    const nextName = draftAction.value.trim();
    if (!nextName) {
      return;
    }

    try {
      const readyForConnection = await ensureRuntimeSecrets(host, "Manage remote files");
      if (!readyForConnection) {
        return;
      }

      if (draftAction.mode === "folder") {
        await runTransfer(
          {
            direction: "remote",
            hostId: host.id,
            hostLabel: host.label,
            name: `mkdir ${nextName}`,
            remotePath: joinRemotePath(currentPath, nextName),
          },
          async () => {
            await createRemoteDirectory(
              buildBackendConnection(host, knownHosts),
              joinRemotePath(currentPath, nextName)
            );
          }
        );
      } else if (selectedEntry) {
        const nextPath = joinRemotePath(getParentPath(selectedEntry.path), nextName);
        await runTransfer(
          {
            direction: "remote",
            hostId: host.id,
            hostLabel: host.label,
            name: `rename ${selectedEntry.name}`,
            remotePath: nextPath,
          },
          async () => {
            await renameRemoteEntry(
              buildBackendConnection(host, knownHosts),
              selectedEntry.path,
              nextPath
            );
          }
        );
      }

      setDraftAction(null);
      await loadDirectory(currentPath);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleUpload = async (file: File) => {
    const remotePath = joinRemotePath(currentPath, file.name);

    try {
      const readyForConnection = await ensureRuntimeSecrets(host, "Upload file");
      if (!readyForConnection) {
        return;
      }

      await runTransfer(
        {
          direction: "upload",
          hostId: host.id,
          hostLabel: host.label,
          name: file.name,
          remotePath,
          bytes: file.size,
        },
        async () => {
          await uploadRemoteFile(buildBackendConnection(host, knownHosts), remotePath, file);
        }
      );
      await loadDirectory(currentPath);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDownload = async () => {
    if (!selectedEntry || selectedEntry.kind !== "file") {
      return;
    }

    try {
      const readyForConnection = await ensureRuntimeSecrets(host, "Download file");
      if (!readyForConnection) {
        return;
      }

      await runTransfer(
        {
          direction: "download",
          hostId: host.id,
          hostLabel: host.label,
          name: selectedEntry.name,
          remotePath: selectedEntry.path,
          bytes: selectedEntry.size,
        },
        async () => {
          const { blob, filename } = await downloadRemoteFile(
            buildBackendConnection(host, knownHosts),
            selectedEntry.path
          );
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = filename;
          anchor.click();
          URL.revokeObjectURL(url);
        }
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) {
      return;
    }

    try {
      const readyForConnection = await ensureRuntimeSecrets(host, "Delete remote entry");
      if (!readyForConnection) {
        return;
      }

      await runTransfer(
        {
          direction: "remote",
          hostId: host.id,
          hostLabel: host.label,
          name: `delete ${deleteTarget.name}`,
          remotePath: deleteTarget.path,
        },
        async () => {
          await deleteRemoteEntry(
            buildBackendConnection(host, knownHosts),
            deleteTarget.path,
            deleteTarget.kind === "directory"
          );
        }
      );
      setDeleteTarget(undefined);
      if (selectedEntry?.path === deleteTarget.path) {
        setSelectedEntry(undefined);
      }
      await loadDirectory(currentPath);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const draftCopy = draftAction ? promptLabels(draftAction.mode) : undefined;

  return (
    <>
      <section className="flex h-full min-h-0 flex-col rounded-[22px] border border-slate-800/80 bg-slate-950/50">
        <div className="grid gap-3 border-b border-slate-800/80 px-3.5 py-2.5 xl:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
              Remote browser
            </p>
            <div className="mt-1.5 flex gap-2">
              <input
                value={draftPath}
                onChange={(event) => setDraftPath(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    rememberRemotePath(host.id, draftPath.trim() || host.sftpRoot || "/");
                  }
                }}
                className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
              />
              <button
                type="button"
                onClick={() => rememberRemotePath(host.id, draftPath.trim() || host.sftpRoot || "/")}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Go
              </button>
              <button
                type="button"
                onClick={() => rememberRemotePath(host.id, host.sftpRoot || "/")}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Root
              </button>
              <button
                type="button"
                onClick={() => rememberRemotePath(host.id, getParentPath(currentPath))}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Up
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-start gap-2 xl:justify-end">
            <button
              type="button"
              onClick={() => void loadDirectory(currentPath)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
            >
              Upload
            </button>
            <button
              type="button"
              onClick={() => setDraftAction({ mode: "folder", value: "" })}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
            >
              New folder
            </button>
            <button
              type="button"
              disabled={!canDownload}
              onClick={() => void handleDownload()}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition enabled:hover:border-slate-500 enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Download
            </button>
            <button
              type="button"
              disabled={!canRename}
              onClick={() =>
                selectedEntry && setDraftAction({ mode: "rename", value: selectedEntry.name })
              }
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition enabled:hover:border-slate-500 enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Rename
            </button>
            <button
              type="button"
              disabled={!canDelete}
              onClick={() => setDeleteTarget(selectedEntry)}
              className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs text-rose-200 transition enabled:hover:border-rose-400 enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Delete
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 px-3.5 py-2">
          <div className="min-w-0">
            <p className="truncate text-xs text-slate-400">
              {host.username}@{host.hostname}:{host.port}
            </p>
            <p className="mt-1 truncate text-[11px] text-slate-500">
              {selectedEntry
                ? `${selectedEntry.kind} · ${selectedEntry.path} · ${formatBytes(selectedEntry.size)}`
                : "Select a file or folder to run operations."}
            </p>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter files"
            className="w-[180px] rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-1.5 text-xs text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
          />
        </div>

        <div className="min-h-0 flex-1 px-3.5 py-2.5">
          {errorMessage ? (
            <div className="mb-3 rounded-[18px] border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
              {errorMessage}
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-[22px] border border-slate-800/80 bg-slate-950/70 px-4 py-10 text-center text-sm text-slate-500">
              Loading remote directory…
            </div>
          ) : (
            <FileList
              currentPath={currentPath}
              entries={filteredEntries}
              selectedPath={selectedPath}
              onNavigateUp={() => rememberRemotePath(host.id, getParentPath(currentPath))}
              onSelect={setSelectedEntry}
              onOpen={(entry) => {
                setSelectedEntry(entry);
                if (entry.kind === "directory") {
                  rememberRemotePath(host.id, entry.path);
                }
              }}
            />
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleUpload(file);
            }
            event.target.value = "";
          }}
        />
      </section>

      <Modal
        open={Boolean(draftAction && draftCopy)}
        title={draftCopy?.title ?? ""}
        description={draftCopy?.description}
        onClose={() => setDraftAction(null)}
        className="max-w-lg"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDraftAction(null)}
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitDraftAction()}
              className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300"
            >
              {draftCopy?.action}
            </button>
          </div>
        }
      >
        <input
          autoFocus
          value={draftAction?.value ?? ""}
          onChange={(event) =>
            setDraftAction((current) => (current ? { ...current, value: event.target.value } : current))
          }
          placeholder={draftCopy?.placeholder}
          className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
        />
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete remote entry"
        description={
          deleteTarget
            ? `Delete ${deleteTarget.path}? Non-empty folders will be rejected by the backend.`
            : ""
        }
        confirmLabel="Delete"
        onCancel={() => setDeleteTarget(undefined)}
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}
