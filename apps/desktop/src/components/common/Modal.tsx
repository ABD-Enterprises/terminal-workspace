import { useEffect, type ReactNode } from "react";
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
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative z-10 w-full max-w-3xl rounded-[32px] border border-slate-700/70 bg-slate-900 p-6 shadow-2xl shadow-slate-950/70",
          className
        )}
      >
        <div className="flex items-start justify-between gap-4">
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
        <div className="mt-6">{children}</div>
        {footer ? <div className="mt-6 border-t border-slate-800 pt-5">{footer}</div> : null}
      </div>
    </div>
  );
}
