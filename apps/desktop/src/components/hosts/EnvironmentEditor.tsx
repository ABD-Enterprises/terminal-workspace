import { useEffect, useState } from "react";
import { Modal } from "../common/Modal";
import {
  emptyHostEnvironmentFormValues,
  formatHostEnvironmentKind,
  type HostEnvironmentFormValues,
  type HostEnvironmentRecord,
} from "../../types/environment";

const fieldClassName =
  "mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20";

interface EnvironmentEditorProps {
  open: boolean;
  environment?: HostEnvironmentRecord;
  onClose: () => void;
  onSave: (values: HostEnvironmentFormValues) => void;
}

function environmentToFormValues(
  environment?: HostEnvironmentRecord
): HostEnvironmentFormValues {
  if (!environment) {
    return emptyHostEnvironmentFormValues;
  }

  return {
    label: environment.label,
    kind: environment.kind,
    description: environment.description,
  };
}

export function EnvironmentEditor({
  open,
  environment,
  onClose,
  onSave,
}: EnvironmentEditorProps) {
  const [values, setValues] = useState<HostEnvironmentFormValues>(() =>
    environmentToFormValues(environment)
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    setValues(environmentToFormValues(environment));
  }, [environment, open]);

  const isInvalid = !values.label.trim();
  const formId = environment ? `environment-editor-${environment.id}` : "environment-editor-new";

  return (
    <Modal
      open={open}
      title={environment ? `Edit ${environment.label}` : "Add environment"}
      description="Use named environments to group inventory by account, cluster, region, or custom operations scope."
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            disabled={isInvalid}
            className="rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            {environment ? "Save environment" : "Create environment"}
          </button>
        </div>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          if (isInvalid) {
            return;
          }

          onSave(values);
        }}
        className="grid gap-5"
      >
        <label className="block">
          <span className="text-sm text-slate-300">Name</span>
          <input
            value={values.label}
            onChange={(event) => setValues((current) => ({ ...current, label: event.target.value }))}
            className={fieldClassName}
            placeholder="Production Account"
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Kind</span>
          <select
            value={values.kind}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                kind: event.target.value as HostEnvironmentFormValues["kind"],
              }))
            }
            className={fieldClassName}
          >
            {(["account", "cluster", "region", "custom"] as const).map((kind) => (
              <option key={kind} value={kind}>
                {formatHostEnvironmentKind(kind)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Description</span>
          <textarea
            value={values.description}
            onChange={(event) =>
              setValues((current) => ({ ...current, description: event.target.value }))
            }
            className={`${fieldClassName} min-h-28 resize-y`}
            placeholder="What hosts belong here and how operators use this environment."
          />
        </label>
      </form>
    </Modal>
  );
}

