import { useEffect } from "react";
import { hasCommandModifier, isTypingTarget } from "../../lib/dom-events";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  // Enter triggers the destructive action. Esc is already wired by the
  // Modal's own Esc button + the backdrop click. Skipped when the user
  // is typing in an input inside the dialog body.
  // See QWEN review keyboard-first item.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter") {
        return;
      }
      if (hasCommandModifier(event) || event.shiftKey) {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      event.preventDefault();
      onConfirm();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onConfirm, open]);

  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={onCancel}
      className="max-w-xl"
      footer={
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-2xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className="rounded-2xl bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400"
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      <p className="text-sm leading-6 text-slate-300">{description}</p>
    </Modal>
  );
}
