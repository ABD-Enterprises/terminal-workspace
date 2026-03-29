import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-[24px] border border-dashed border-slate-700/80 bg-slate-950/40 p-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/70 text-lg text-emerald-300">
        +
      </div>
      <h3 className="mt-3 text-base font-semibold text-slate-100">{title}</h3>
      <p className="mt-2 text-sm leading-5 text-slate-400">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
