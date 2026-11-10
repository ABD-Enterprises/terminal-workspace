import { useEffect } from "react";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Which button receives initial focus when the dialog opens.
   * Defaults to "cancel" to prevent accidental destructive actions (#512).
   */
  defaultFocus?: "cancel" | "confirm";
  onCancel: () => void;
  onConfirm: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  // Confirm dialogs in this app don't currently host any inputs, but the
  // guard is cheap and future-proofs against someone adding e.g. a
  // "type the host name to confirm" prompt.
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  return target.isContentEditable;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  defaultFocus = "cancel",
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  // Esc is already wired by the Modal's own Esc button + the backdrop click.
  // Enter only triggers confirmation when defaultFocus is explicitly set to
  // "confirm" (#512: destructive dialogs default focus to Cancel so reflexively
  // pressing Enter safely dismisses the dialog rather than executing irreversible deletion).
  useEffect(() => {
    if (!open || defaultFocus !== "confirm") {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter") {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
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
  }, [defaultFocus, onConfirm, open]);

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
            autoFocus={defaultFocus === "cancel"}
            className="rounded-2xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus={defaultFocus === "confirm"}
            className="rounded-2xl bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400"
          >
            {confirmLabel}
          </button>
        </div>
      }
    />
  );
}
