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

const privateKeyBoundary = (kind: string, boundary: "BEGIN" | "END") =>
  `-----${boundary} ${kind} PRIVATE KEY-----`;

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

          {/*
            T13: paste-from-clipboard. Fill the textarea with a key
            body (we validate the PEM headers client-side before the
            backend write). When non-empty, the import flow writes the
            body to `privateKeyPath` with 0600 perms before inspecting.
            When empty, the existing path-only inspect path runs.
          */}
          <div className="rounded-[18px] border border-slate-800 bg-slate-950/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Paste key body (optional)
              </span>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    setImportValues((current) => ({ ...current, pastedKeyBody: text }));
                  } catch {
                    // Clipboard read denied — leave the textarea
                    // untouched; the user can paste manually.
                  }
                }}
                className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200 transition hover:border-emerald-400/60 hover:bg-emerald-400/15"
              >
                Paste from clipboard
              </button>
            </div>
            <textarea
              value={importValues.pastedKeyBody}
              onChange={(event) =>
                setImportValues((current) => ({ ...current, pastedKeyBody: event.target.value }))
              }
              placeholder={
                `${privateKeyBoundary("OPENSSH", "BEGIN")}\n...\n${privateKeyBoundary("OPENSSH", "END")}`
              }
              spellCheck={false}
              rows={5}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 font-mono text-[11px] leading-5 text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
            />
            <p className="mt-2 text-[11px] leading-5 text-slate-500">
              If the body is non-empty it will be written to the path above (0600 perms) before
              inspection. Leave empty to import an existing file by path.
            </p>
          </div>
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
              <option value="ed25519">Ed25519 (recommended)</option>
              <option value="ecdsa">ECDSA</option>
              <option value="rsa">RSA</option>
            </select>
            {/* T11: per-type guidance so new users pick the right algorithm. */}
            <p className="mt-2 text-[11px] leading-5 text-slate-500">
              {generateValues.type === "ed25519"
                ? "Modern default. Small key, fast, supported by every OpenSSH ≥ 6.5."
                : generateValues.type === "ecdsa"
                  ? "521-bit curve. Compatible with hardware tokens that don't support Ed25519."
                  : "4096-bit RSA. Required for ancient SSH servers (pre-2014); avoid otherwise."}
            </p>
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
              <span className="ml-2 normal-case tracking-normal text-emerald-300/90">
                recommended
              </span>
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={generateValues.passphrase}
              onChange={(event) =>
                setGenerateValues((current) => ({ ...current, passphrase: event.target.value }))
              }
              placeholder="Optional but strongly recommended"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
            />
            <p className="mt-2 text-[11px] leading-5 text-slate-500">
              Without a passphrase, anyone with read access to the key file can use it.
            </p>
          </label>
        </div>
      )}
      </form>
    </Modal>
  );
}
