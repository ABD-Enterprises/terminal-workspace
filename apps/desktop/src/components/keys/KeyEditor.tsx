import { useState } from "react";
import {
  emptyGenerateKeyValues,
  emptyImportKeyValues,
  type GenerateKeyValues,
  type ImportKeyValues,
} from "../../types/key";
import { Modal } from "../common/Modal";

interface KeyEditorProps {
  mode: "import" | "generate";
  open: boolean;
  busy?: boolean;
  errorMessage?: string;
  onClose: () => void;
  onImport: (values: ImportKeyValues) => Promise<void>;
  onGenerate: (values: GenerateKeyValues) => Promise<void>;
}

export function KeyEditor({
  mode,
  open,
  busy = false,
  errorMessage,
  onClose,
  onImport,
  onGenerate,
}: KeyEditorProps) {
  const [importValues, setImportValues] = useState(emptyImportKeyValues);
  const [generateValues, setGenerateValues] = useState(emptyGenerateKeyValues);

  const isImport = mode === "import";
  const formId = isImport ? "import-key-form" : "generate-key-form";

  return (
    <Modal
      open={open}
      title={isImport ? "Import private key" : "Generate private key"}
      description={
        isImport
          ? "Add an existing local private key to the TermSnip inventory."
          : "Generate a new SSH keypair locally with ssh-keygen."
      }
      onClose={onClose}
      className="max-w-2xl"
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
            type="submit"
            form={formId}
            disabled={busy}
            className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Working…" : isImport ? "Import key" : "Generate key"}
          </button>
        </div>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          void (isImport ? onImport(importValues) : onGenerate(generateValues));
        }}
      >
      {errorMessage ? (
        <div className="mb-4 rounded-[18px] border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {errorMessage}
        </div>
      ) : null}

      {isImport ? (
        <div className="grid gap-4">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Label
            </span>
            <input
              value={importValues.label}
              onChange={(event) =>
                setImportValues((current) => ({ ...current, label: event.target.value }))
              }
              placeholder="MacBook Pro ED25519"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Private key path
            </span>
            <input
              value={importValues.privateKeyPath}
              onChange={(event) =>
                setImportValues((current) => ({ ...current, privateKeyPath: event.target.value }))
              }
              placeholder="~/.ssh/id_ed25519"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
            />
          </label>
          <label className="flex items-center gap-3 rounded-[18px] border border-slate-800 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={importValues.hasPassphrase}
              onChange={(event) =>
                setImportValues((current) => ({ ...current, hasPassphrase: event.target.checked }))
              }
            />
            Key uses a passphrase
          </label>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Label
            </span>
            <input
              value={generateValues.label}
              onChange={(event) =>
                setGenerateValues((current) => ({ ...current, label: event.target.value }))
              }
              placeholder="Generated Ops Key"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Private key path
            </span>
            <input
              value={generateValues.privateKeyPath}
              onChange={(event) =>
                setGenerateValues((current) => ({ ...current, privateKeyPath: event.target.value }))
              }
              placeholder="~/.ssh/termsnip_ed25519"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
            />
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Type
            </span>
            <select
              value={generateValues.type}
              onChange={(event) =>
                setGenerateValues((current) => ({
                  ...current,
                  type: event.target.value as GenerateKeyValues["type"],
                }))
              }
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
            >
              <option value="ed25519">Ed25519</option>
              <option value="ecdsa">ECDSA</option>
              <option value="rsa">RSA</option>
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Comment
            </span>
            <input
              value={generateValues.comment}
              onChange={(event) =>
                setGenerateValues((current) => ({ ...current, comment: event.target.value }))
              }
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Passphrase
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={generateValues.passphrase}
              onChange={(event) =>
                setGenerateValues((current) => ({ ...current, passphrase: event.target.value }))
              }
              placeholder="Optional"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
            />
          </label>
        </div>
      )}
      </form>
    </Modal>
  );
}
