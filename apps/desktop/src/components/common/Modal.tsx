import { useEffect, type ReactNode } from "react";
import { hasCommandModifier } from "../../lib/dom-events";
import { cn } from "../../lib/utils";

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  className,
}: ModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Esc closes the modal, matching the visible "Esc" button in the
  // header. Without this listener the button was the only way out via
  // keyboard, which broke the keyboard-first promise that QWEN's review
  // called out. ConfirmDialog adds Enter handling on top of this; nested
  // useCommandPalette / useKeyboardCheatsheet listeners also key off
  // Escape, but those state machines guard their own opens so a single
  // Esc cleans up exactly the topmost layer.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      // Don't compete with browser-level dismissals when a modifier is
      // held — those combos belong to other handlers.
      if (hasCommandModifier(event)) {
        return;
      }
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-6 py-10 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      {/*
        The dialog frame is a flex column with a hard max-height so it never
        exceeds the viewport. Header + footer stay pinned (no shrink), the
        body fills the remaining space and scrolls. Without this the
        HostEditor / IdentityEditor / KeyEditor forms could exceed the
        viewport on shorter screens (1080p with the dock visible) and the
        Cancel + Create buttons were unreachable — reported by the user
        with a 13" MBP screenshot of the Add host modal.
      */}
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative z-10 flex max-h-[calc(100vh-5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[32px] border border-slate-700/70 bg-slate-900 shadow-2xl shadow-slate-950/70",
          className
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-emerald-300">
              Local Workspace
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-50">{title}</h2>
            {description ? <p className="mt-2 text-sm text-slate-400">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
          >
            Esc
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t border-slate-800 bg-slate-900 px-6 py-5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
