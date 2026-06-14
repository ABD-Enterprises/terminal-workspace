// #106: one source-list section. Every list group in the sidebar —
// Recent, Pinned, Sessions, Groups — renders through this so they share a
// single scroll region (the parent <aside>), a light top-rule separator
// instead of a bordered card, and a consistent collapsible header. The
// optional `regionLabel` lands on the *body* (not the toggle button) so an
// ARIA region wraps only the rows, keeping assistive queries unambiguous.

import { useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";

interface SidebarSectionProps {
  title: string;
  count?: number;
  /** Tailwind text-color class for the section eyebrow. */
  accentClass?: string;
  /** When set, the section body is exposed as an ARIA region with this name. */
  regionLabel?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function SidebarSection({
  title,
  count,
  accentClass = "text-slate-500",
  regionLabel,
  defaultOpen = true,
  children,
}: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyProps = regionLabel ? { role: "region", "aria-label": regionLabel } : {};

  return (
    <section className="mt-3 border-t border-slate-800/60 pt-2 first:mt-0 first:border-t-0 first:pt-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-control px-1.5 py-1 text-left transition hover:bg-slate-800/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400/40"
      >
        <span
          aria-hidden="true"
          className={cn(
            "inline-block text-[8px] leading-none text-slate-500 transition-transform",
            open ? "" : "-rotate-90"
          )}
        >
          ▼
        </span>
        <span className={cn("text-caption font-semibold uppercase tracking-label", accentClass)}>
          {title}
        </span>
        {typeof count === "number" ? (
          <span className="ml-auto text-caption tabular-nums text-slate-600">{count}</span>
        ) : null}
      </button>
      {open ? (
        <div {...bodyProps} className="mt-1 space-y-1">
          {children}
        </div>
      ) : null}
    </section>
  );
}
