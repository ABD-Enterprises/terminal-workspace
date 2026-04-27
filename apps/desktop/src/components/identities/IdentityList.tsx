// List view of all reusable identities. Shows label, username, auth method,
// "used by N hosts" indicator, and edit/delete actions per row. Used inside
// the Settings "Reusable Identities" panel.
//
// Delete shows a warning when hosts still reference the identity — we do
// not block, just call it out (the runtime in batch 2 still reads per-host
// fields, so a deleted identity does not break anything immediately; it
// just orphans the linkage). Batch 3 will harden this by requiring a
// re-link before delete.
//
// See docs/parity-and-hardening-plan.md P2-DM1 (batch 2).

import { cn } from "../../lib/utils";
import type { IdentityRecord } from "../../types/identity";

interface IdentityListProps {
  identities: IdentityRecord[];
  usageByIdentityId: Map<string, string[]>;
  editingIdentityId?: string;
  onEdit: (identityId: string) => void;
  onDelete: (identityId: string) => void;
}

function formatAuthMethod(method: IdentityRecord["authMethod"]) {
  switch (method) {
    case "privateKey":
      return "Private key";
    case "password":
      return "Password";
    case "none":
      return "None";
  }
}

export function IdentityList({
  identities,
  usageByIdentityId,
  editingIdentityId,
  onEdit,
  onDelete,
}: IdentityListProps) {
  if (identities.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 px-4 py-6 text-sm text-slate-400">
        No identities yet. Hosts will derive identities automatically the next
        time the workspace loads, or you can create one manually below.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {identities.map((identity) => {
        const usage = usageByIdentityId.get(identity.id) ?? [];
        const usageCount = usage.length;
        const isEditing = identity.id === editingIdentityId;

        return (
          <li
            key={identity.id}
            className={cn(
              "rounded-2xl border bg-slate-950/40 px-3 py-2.5 transition",
              isEditing
                ? "border-emerald-400/50 bg-emerald-400/5"
                : "border-slate-800 hover:border-slate-700"
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium text-slate-100">
                    {identity.label}
                  </p>
                  <span
                    className={cn(
                      "rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em]",
                      identity.source === "imported"
                        ? "border-emerald-400/40 text-emerald-200"
                        : "border-slate-600 text-slate-300"
                    )}
                    title={
                      identity.source === "imported"
                        ? "User-owned. Re-running the migration will not overwrite this."
                        : "Auto-derived from a host. Editing will mark it as user-owned."
                    }
                  >
                    {identity.source}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-400">
                  {identity.username || "(no username)"} · {formatAuthMethod(identity.authMethod)}
                  {identity.privateKeyPath ? (
                    <>
                      {" · "}
                      <code className="text-[11px] text-slate-300">{identity.privateKeyPath}</code>
                    </>
                  ) : null}
                </p>
                {identity.comment ? (
                  <p className="mt-1 truncate text-xs text-slate-500">{identity.comment}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]",
                    usageCount === 0
                      ? "border-slate-700 text-slate-500"
                      : "border-sky-400/40 text-sky-200"
                  )}
                  title={
                    usageCount === 0
                      ? "No hosts use this identity yet."
                      : `Used by ${usageCount} host${usageCount === 1 ? "" : "s"}`
                  }
                >
                  {usageCount} host{usageCount === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  onClick={() => onEdit(identity.id)}
                  className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(identity.id)}
                  className="rounded-lg border border-rose-500/40 px-2.5 py-1 text-xs text-rose-200 transition hover:border-rose-400 hover:text-white"
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
