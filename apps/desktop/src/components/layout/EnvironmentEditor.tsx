import { useState } from "react";
import { type EnvironmentRecord, type EnvironmentType } from "../../types/environment";
import { Modal } from "../common/Modal";

interface EnvironmentEditorProps {
  open: boolean;
  environment?: EnvironmentRecord;
  onClose: () => void;
  onSave: (values: { name: string; type: EnvironmentType }) => void;
}

const fieldClassName =
  "mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20";

export function EnvironmentEditor({ open, environment, onClose, onSave }: EnvironmentEditorProps) {
  const [name, setName] = useState(environment?.name ?? "");
  const [type, setType] = useState<EnvironmentType>(environment?.type ?? "custom");

  const isInvalid = !name.trim();

  return (
    <Modal
      open={open}
      title={environment ? `Edit ${environment.name}` : "Add Environment"}
      description="Create a logical grouping for your hosts like an AWS account or Kubernetes cluster."
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
            type="button"
            disabled={isInvalid}
            onClick={() => {
              if (isInvalid) return;
              onSave({ name, type });
            }}
            className="rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            {environment ? "Save changes" : "Create"}
          </button>
        </div>
      }
    >
      <div className="grid gap-5">
        <label className="block">
          <span className="text-sm text-slate-300">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={fieldClassName}
            placeholder="Acme / Production"
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as EnvironmentType)}
            className={fieldClassName}
          >
            <option value="custom">Custom Group</option>
            <option value="aws">AWS Account</option>
            <option value="k8s">Kubernetes Cluster</option>
            <option value="region">Region</option>
          </select>
        </label>
      </div>
    </Modal>
  );
}
