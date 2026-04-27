// Inline form for creating or editing an Identity. Used inside the Settings
// "Reusable Identities" panel — kept simple on purpose: no fancy multi-step,
// just the core fields that drive runtime auth. Renders as a card so the
// list view can show it inline beside the entries it edits.
//
// See docs/parity-and-hardening-plan.md P2-DM1 (batch 2).

import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import {
  type IdentityRecord,
  type IdentitySource,
} from "../../types/identity";
import type { HostAuthMethod } from "../../types/host";

export interface IdentityEditorValues {
  label: string;
  username: string;
  authMethod: HostAuthMethod;
  privateKeyPath: string;
  hasPassphrase: boolean;
  comment: string;
}

interface IdentityEditorProps {
  open: boolean;
  identity?: IdentityRecord;
  onCancel: () => void;
  onSubmit: (values: IdentityEditorValues, source: IdentitySource) => void;
}

const fieldClassName =
  "mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20";

function buildInitialValues(identity?: IdentityRecord): IdentityEditorValues {
  if (!identity) {
    return {
      label: "",
      username: "",
      authMethod: "privateKey",
      privateKeyPath: "",
      hasPassphrase: false,
      comment: "",
    };
  }
  return {
    label: identity.label,
    username: identity.username,
    authMethod: identity.authMethod,
    privateKeyPath: identity.privateKeyPath,
    hasPassphrase: identity.hasPassphrase,
    comment: identity.comment,
  };
}

export function IdentityEditor({
  open,
  identity,
  onCancel,
  onSubmit,
}: IdentityEditorProps) {
  const [values, setValues] = useState<IdentityEditorValues>(() =>
    buildInitialValues(identity)
  );

  // Reset the form when the editor switches between identities or transitions
  // open ↔ closed. Without this the Settings panel keeps stale values when
  // the user clicks Edit on a different row.
  useEffect(() => {
    setValues(buildInitialValues(identity));
  }, [identity, open]);

  if (!open) {
    return null;
  }

  const isInvalid =
    !values.label.trim() ||
    !values.username.trim() ||
    (values.authMethod === "privateKey" && !values.privateKeyPath.trim());

  // Editing an existing derived identity becomes "imported" — the user has
  // taken ownership of it and a future re-derivation must not overwrite
  // their edits.
  const nextSource: IdentitySource = identity?.source === "imported" ? "imported" : "imported";

  return (
    <form
      className="rounded-2xl border border-emerald-400/30 bg-emerald-400/5 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (isInvalid) {
          return;
        }
        onSubmit(values, nextSource);
      }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-300">
        {identity ? "Edit identity" : "New identity"}
      </p>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <label className="block text-xs uppercase tracking-[0.14em] text-slate-500">
          Label
          <input
            value={values.label}
            onChange={(event) =>
              setValues((current) => ({ ...current, label: event.target.value }))
            }
            className={fieldClassName}
            placeholder="Deploy Shared Key (deploy)"
            autoFocus
          />
        </label>
        <label className="block text-xs uppercase tracking-[0.14em] text-slate-500">
          Username
          <input
            value={values.username}
            onChange={(event) =>
              setValues((current) => ({ ...current, username: event.target.value }))
            }
            className={fieldClassName}
            placeholder="deploy"
          />
        </label>
        <label className="block text-xs uppercase tracking-[0.14em] text-slate-500">
          Auth method
          <select
            value={values.authMethod}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                authMethod: event.target.value as HostAuthMethod,
              }))
            }
            className={fieldClassName}
          >
            <option value="privateKey">Private key</option>
            <option value="password">Password</option>
            <option value="none">None / manual later</option>
          </select>
        </label>
        {values.authMethod === "privateKey" ? (
          <label className="block text-xs uppercase tracking-[0.14em] text-slate-500">
            Private key path
            <input
              value={values.privateKeyPath}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  privateKeyPath: event.target.value,
                }))
              }
              className={fieldClassName}
              placeholder="~/.ssh/id_ed25519"
            />
          </label>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-400">
            No key path needed for this auth method.
          </div>
        )}
        <label
          className={cn(
            "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs",
            values.authMethod === "privateKey"
              ? "border-slate-800 bg-slate-950/50 text-slate-300"
              : "border-slate-800/40 bg-slate-950/30 text-slate-500"
          )}
        >
          <input
            type="checkbox"
            checked={values.hasPassphrase}
            disabled={values.authMethod !== "privateKey"}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                hasPassphrase: event.target.checked,
              }))
            }
            className="h-3.5 w-3.5 accent-emerald-400 disabled:opacity-40"
          />
          Key requires a passphrase
        </label>
        <label className="block text-xs uppercase tracking-[0.14em] text-slate-500 md:col-span-2">
          Notes
          <textarea
            value={values.comment}
            onChange={(event) =>
              setValues((current) => ({ ...current, comment: event.target.value }))
            }
            className={`${fieldClassName} min-h-16 resize-y`}
            placeholder="Optional context for this identity."
          />
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isInvalid}
          className="rounded-xl bg-emerald-400 px-3 py-1.5 text-xs font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          {identity ? "Save changes" : "Create identity"}
        </button>
      </div>
    </form>
  );
}
