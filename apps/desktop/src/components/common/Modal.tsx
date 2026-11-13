import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  className,
}: ModalProps) {
  const baseId = useId();
  const titleId = `${baseId}-modal-title`;
  const descriptionId = `${baseId}-modal-description`;
  const dialogRef = useRef<HTMLDivElement>(null);

  // Track open state transitions during render.
  // When transitioning closed -> open, record document.activeElement before any child
  // component's autoFocus or mount effect can shift focus (#505).
  const [lastOpen, setLastOpen] = useState(open);
  const [previouslyFocusedElement, setPreviouslyFocusedElement] = useState<HTMLElement | null>(null);

  if (open !== lastOpen) {
    setLastOpen(open);
    if (open && typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      setPreviouslyFocusedElement(document.activeElement);
    }
  }

  // Restore focus to the trigger element when the dialog closes (#505). The cleanup must run
  // only when `open` changes (or the Modal unmounts while open), never because the remembered
  // element changed: callers keep the Modal mounted and toggle `open`, so a cleanup keyed on the
  // element would refocus the old trigger after the next open's autoFocus had run.
  const previousFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previousFocusRef.current = previouslyFocusedElement;
  }, [previouslyFocusedElement]);
  useEffect(() => {
    if (!open) {
      return;
    }
    return () => {
      const target = previousFocusRef.current;
      if (target && typeof target.focus === "function") {
        target.focus();
      }
    };
  }, [open]);

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

  // Focus management: move focus into the dialog on open (if not already focused via autoFocus) (#505).
  useEffect(() => {
    if (!open) {
      return;
    }

    const frame = dialogRef.current;
    if (frame) {
      const activeEl = document.activeElement;
      // If an inner element already has focus (e.g. from React autoFocus), don't override it.
      if (!activeEl || !frame.contains(activeEl)) {
        const focusable = frame.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusable.length > 0) {
          focusable[0]?.focus();
        } else {
          frame.focus();
        }
      }
    }
  }, [open]);

  // Esc closes the modal, matching the visible "Esc" button in the
  // header. ConfirmDialog adds Enter handling on top of this.
  // Tab and Shift+Tab trap focus inside the dialog frame (#505).
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Don't compete with browser-level dismissals when a modifier is
        // held - those combos belong to other handlers.
        if (event.metaKey || event.ctrlKey || event.altKey) {
          return;
        }
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "Tab") {
        const frame = dialogRef.current;
        if (!frame) {
          return;
        }

        const focusables = Array.from(
          frame.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0 || el === document.activeElement);

        if (focusables.length === 0) {
          event.preventDefault();
          frame.focus();
          return;
        }

        const firstElement = focusables[0];
        const lastElement = focusables[focusables.length - 1];

        if (event.shiftKey) {
          if (document.activeElement === firstElement || !frame.contains(document.activeElement)) {
            event.preventDefault();
            lastElement?.focus();
          }
        } else {
          if (document.activeElement === lastElement || !frame.contains(document.activeElement)) {
            event.preventDefault();
            firstElement?.focus();
          }
        }
      }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs sm:px-6 sm:py-10">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
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
        Cancel + Create buttons were unreachable - reported by the user
        with a 13" MBP screenshot of the Add host modal.

        #UX-1: use dynamic viewport units (dvh) and tighter padding on small
        screens, so the clamp stays honest when the browser/Tauri chrome
        shrinks the visual viewport and when the user sizes the window near
        the new minimum (960x600).

        #UX-2: the chrome reads shell theme tokens (--shell-*) and the frame
        carries .tw-modal-surface, which pins those tokens to their dark
        values. Dialog contents (forms, prompts) are written for a dark
        surface (pale slate/amber text), so the dialog stays dark in both
        themes instead of turning white under pale text.
      */}
      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          "tw-modal-surface relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[32px] border border-[color:var(--shell-border)] bg-[color:var(--shell-panel)] shadow-2xl shadow-slate-950/70 outline-none sm:max-h-[calc(100dvh-5rem)]",
          className
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[color:var(--shell-accent)]">
              Local Workspace
            </p>
            <h2 id={titleId} className="mt-2 text-2xl font-semibold text-[color:var(--shell-text)]">{title}</h2>
            {description ? <p id={descriptionId} className="mt-2 text-sm text-[color:var(--shell-muted)]">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-base)] px-3 py-2 text-sm text-[color:var(--shell-text)] transition hover:border-[color:var(--shell-muted)]"
          >
            Esc
          </button>
        </div>
        {children ? <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div> : null}
        {footer ? (
          <div className="shrink-0 border-t border-[color:var(--shell-border)] bg-[color:var(--shell-panel)] px-6 py-5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
