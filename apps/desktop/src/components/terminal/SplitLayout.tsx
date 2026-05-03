import { useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import type { SplitDirection } from "../../types/session";

interface SplitLayoutProps {
  direction: SplitDirection;
  /** Children rendered as an array so we can interleave a draggable
   *  splitter between them in the 2-pane case. Each entry corresponds to
   *  one terminal pane. */
  panes: ReactNode[];
  /** Persisted ratio (0..1) for the first pane along the split axis when
   *  exactly two panes are present. Defaults to 0.5 when undefined. */
  splitRatio?: number;
  /** Called when the user finishes dragging the splitter. The store
   *  clamps to a safe range. */
  onSplitRatioChange?: (ratio: number) => void;
}

const DEFAULT_RATIO = 0.5;
const MIN_RATIO = 0.1;
const MAX_RATIO = 0.9;

/**
 * Bonus parity round: terminal layout gains a draggable splitter for the
 * 2-pane case so users can tune the split to taste, and tabs are
 * reorderable in TerminalTabView.
 *
 * Layout strategy:
 *   - 1 pane → trivial single column.
 *   - 2 panes → CSS grid with `Xfr <gap> Yfr` template along the split
 *     axis, plus a 6-px draggable splitter between them. Mouse-down on
 *     the splitter captures the parent's bounding rect and computes the
 *     new ratio on each mousemove. The store clamps the persisted ratio
 *     in [0.1, 0.9].
 *   - 3+ panes → fall back to the old 2-col grid; multi-pane resize is
 *     a separate feature ticket. Documented inline.
 */
export function SplitLayout({
  direction,
  panes,
  splitRatio,
  onSplitRatioChange,
}: SplitLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragRatio, setDragRatio] = useState<number | null>(null);

  if (panes.length === 0) {
    return null;
  }
  if (panes.length === 1) {
    return <div className="grid min-h-[440px] grid-cols-1 gap-3">{panes[0]}</div>;
  }
  if (panes.length >= 3) {
    return (
      <div
        className={cn(
          "grid min-h-[440px] gap-3",
          direction === "vertical" ? "grid-cols-2" : "grid-cols-1 lg:grid-cols-2"
        )}
      >
        {panes}
      </div>
    );
  }

  // 2-pane case — resizable.
  const isVertical = direction === "vertical";
  const ratio = Math.min(
    MAX_RATIO,
    Math.max(MIN_RATIO, dragRatio ?? splitRatio ?? DEFAULT_RATIO)
  );
  const gridTemplate = `${ratio}fr 6px ${1 - ratio}fr`;

  const startDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const rect = container.getBoundingClientRect();
    let latestRatio = ratio;
    const handleMove = (moveEvent: MouseEvent) => {
      const offset = isVertical
        ? moveEvent.clientX - rect.left
        : moveEvent.clientY - rect.top;
      const total = isVertical ? rect.width : rect.height;
      if (total <= 0) {
        return;
      }
      const next = Math.min(MAX_RATIO, Math.max(MIN_RATIO, offset / total));
      latestRatio = next;
      setDragRatio(next);
    };
    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      // Persist on release rather than on every mousemove — keeps zustand
      // updates (and the localStorage write) at a sane rate.
      setDragRatio(null);
      onSplitRatioChange?.(latestRatio);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  return (
    <div
      ref={containerRef}
      className="grid min-h-[440px]"
      style={{
        ...(isVertical
          ? { gridTemplateColumns: gridTemplate }
          : { gridTemplateRows: gridTemplate }),
      }}
    >
      <div className="min-h-0 min-w-0 overflow-hidden">{panes[0]}</div>
      <div
        role="separator"
        aria-orientation={isVertical ? "vertical" : "horizontal"}
        aria-valuemin={MIN_RATIO * 100}
        aria-valuemax={MAX_RATIO * 100}
        aria-valuenow={Math.round(ratio * 100)}
        tabIndex={0}
        onMouseDown={startDrag}
        onKeyDown={(event) => {
          // Keyboard users can nudge the splitter ±2% per arrow press.
          if (
            (isVertical && (event.key === "ArrowLeft" || event.key === "ArrowRight")) ||
            (!isVertical && (event.key === "ArrowUp" || event.key === "ArrowDown"))
          ) {
            event.preventDefault();
            const delta =
              event.key === "ArrowLeft" || event.key === "ArrowUp" ? -0.02 : 0.02;
            const next = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio + delta));
            onSplitRatioChange?.(next);
          }
        }}
        className={cn(
          "z-10 self-stretch bg-slate-800 transition hover:bg-emerald-400/40",
          isVertical
            ? "cursor-col-resize w-[6px]"
            : "cursor-row-resize h-[6px]"
        )}
        aria-label={isVertical ? "Resize horizontal split" : "Resize vertical split"}
      />
      <div className="min-h-0 min-w-0 overflow-hidden">{panes[1]}</div>
    </div>
  );
}
