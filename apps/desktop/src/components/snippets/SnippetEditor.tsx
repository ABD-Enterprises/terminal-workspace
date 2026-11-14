import { useId, useMemo, useRef, useState } from "react";
import { Modal } from "../common/Modal";
import { formatHostAddress } from "../../lib/utils";
import { emptySnippetFormValues, snippetToFormValues, type SnippetFormValues, type SnippetRecord } from "../../types/snippet";
import type { HostRecord } from "../../types/host";

interface SnippetEditorProps {
  open: boolean;
  snippet?: SnippetRecord;
  hosts: HostRecord[];
  onClose: () => void;
  onSave: (values: SnippetFormValues) => void;
}

export function SnippetEditor({ open, snippet, hosts, onClose, onSave }: SnippetEditorProps) {
  const formId = useId();
  const [draft, setDraft] = useState<SnippetFormValues>(
    snippet ? snippetToFormValues(snippet) : emptySnippetFormValues
  );
  // The save button used to disable itself while required fields were blank,
  // leaving no clue which field was at fault. Validate on submit instead,
  // mark the offending fields, and move focus to the first one.
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const commandRef = useRef<HTMLTextAreaElement>(null);

  const titleError = draft.title.trim() ? null : "A title is required.";
  const commandError = draft.command.trim() ? null : "A command is required.";

  const handleSubmit = () => {
    if (titleError || commandError) {
      setSubmitAttempted(true);
      (titleError ? titleRef : commandRef).current?.focus();
      return;
    }

    onSave(draft);
  };

  const hostOptions = useMemo(
    () =>
      hosts
        .filter((host) => host.protocol === "ssh")
        .map((host) => ({ id: host.id, label: host.label, address: formatHostAddress(host) })),
    [hosts]
  );

  return (
    <Modal
      open={open}
      title={snippet ? "Edit snippet" : "Create snippet"}
      description="Save a reusable command, attach default hosts, and reuse it across live sessions."
      onClose={onClose}
      className="max-w-4xl"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {snippet ? "Save snippet" : "Create snippet"}
          </button>
        </div>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Title
            </span>
            <input
              ref={titleRef}
              autoFocus
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              placeholder="Restart billing workers"
              aria-invalid={submitAttempted && titleError ? true : undefined}
              aria-describedby={submitAttempted && titleError ? `${formId}-title-error` : undefined}
              className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
            />
          </label>
          {submitAttempted && titleError ? (
            <p id={`${formId}-title-error`} role="alert" className="-mt-1 text-xs text-rose-200">
              {titleError}
            </p>
          ) : null}

          <label className="grid gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Description
            </span>
            <input
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
              placeholder="Operator shortcut for repetitive checks"
              className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Command
            </span>
            <textarea
              ref={commandRef}
              rows={8}
              value={draft.command}
              onChange={(event) => setDraft((current) => ({ ...current, command: event.target.value }))}
              placeholder="uname -a && uptime"
              aria-invalid={submitAttempted && commandError ? true : undefined}
              aria-describedby={submitAttempted && commandError ? `${formId}-command-error` : undefined}
              className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
            />
          </label>
          {submitAttempted && commandError ? (
            <p id={`${formId}-command-error`} role="alert" className="-mt-1 text-xs text-rose-200">
              {commandError}
            </p>
          ) : null}

          <label className="grid gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Tags
            </span>
            <input
              value={draft.tags}
              onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
              placeholder="ops, logs, restart"
              className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
            />
          </label>
        </div>

        <div className="rounded-[20px] border border-slate-800 bg-slate-950/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Default targets
            </p>
            <button
              type="button"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  targetHostIds:
                    current.targetHostIds.length === hostOptions.length
                      ? []
                      : hostOptions.map((host) => host.id),
                }))
              }
              className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-white"
            >
              {draft.targetHostIds.length === hostOptions.length ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="mt-2 max-h-[320px] space-y-1.5 overflow-auto pr-1">
            {hostOptions.map((host) => {
              const selected = draft.targetHostIds.includes(host.id);

              return (
                <label
                  key={host.id}
                  className={`flex items-start gap-3 rounded-[14px] border px-3 py-2 text-sm transition ${
                    selected
                      ? "border-emerald-400/40 bg-emerald-400/10"
                      : "border-slate-800 bg-slate-950/70"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() =>
                      setDraft((current) => ({
                        ...current,
                        targetHostIds: selected
                          ? current.targetHostIds.filter((entry) => entry !== host.id)
                          : [...current.targetHostIds, host.id],
                      }))
                    }
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-100">{host.label}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                      {host.address}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
