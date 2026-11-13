import { useEffect, useRef, useState, type ReactNode } from "react";
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
 * #UX-1 (Phase 1): hard pixel floor for a pane along the split axis. A ratio
 * clamp alone cannot express this — 10% of a 1600px window is comfortable,
 * 10% of a 640px-minimum window is a 64px sliver with a 4px font.
 */
const MIN_PANE_PX = {
  vertical: 320,
  horizontal: 200,
} as const;

function clampRatio(value: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
}

/**
 * Clamp a split ratio so that, given the container's measured size along the
 * split axis, neither pane drops below `minPx`. Without a measurement (first
 * render, jsdom) falls back to the legacy ratio-only clamp. When the
 * container is smaller than two minimums, split evenly so both panes
 * undershoot equally rather than one being crushed to nothing.
 */
function clampRatioForSize(value: number, size: number | null, minPx: number): number {
  if (!size || size <= 0) {
    return clampRatio(value);
  }
  const floor = clampRatio(minPx / size);
  const ceil = 1 - floor;
  if (ceil < floor) {
    return DEFAULT_RATIO;
  }
  return Math.min(ceil, Math.max(floor, value));
}

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
 *     in [0.1, 0.9]; the component additionally clamps it in pixels
 *     (#UX-1) so a narrow window can never produce sub-minimum panes.
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
  const [containerSize, setContainerSize] = useState<number | null>(null);
  const isVertical = direction === "vertical";
  const minPanePx = isVertical ? MIN_PANE_PX.vertical : MIN_PANE_PX.horizontal;

  // #UX-1: track the container's size along the split axis (window resizes,
  // density changes, split-pane drags elsewhere) so the ratio clamps below
  // are computed in pixels, not just percents. Guarded: jsdom has no
  // ResizeObserver and the 0/1/3+ pane layouts never attach this ref.
  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      setContainerSize(
        Math.round(isVertical ? entry.contentRect.width : entry.contentRect.height)
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [isVertical]);

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

  // 2-pane case — resizable, clamped to a pixel floor per pane (#UX-1).
  const ratio = clampRatioForSize(
    dragRatio ?? splitRatio ?? DEFAULT_RATIO,
    containerSize,
    minPanePx
  );
  const gridTemplate = `${ratio}fr 6px ${1 - ratio}fr`;
  // The pixel floor, expressed as a ratio for the separator's ARIA bounds.
  const ariaFloor =
    containerSize && containerSize > 0
      ? Math.round(clampRatio(minPanePx / containerSize) * 100)
      : Math.round(MIN_RATIO * 100);

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
      const next = clampRatioForSize(offset / total, total, minPanePx);
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
        aria-valuemin={ariaFloor}
        aria-valuemax={100 - ariaFloor}
        aria-valuenow={Math.round(ratio * 100)}
        tabIndex={0}
        onMouseDown={startDrag}
        onKeyDown={(event) => {
          // Keyboard users can nudge the splitter ±2% per arrow press,
          // subject to the same pixel floor as the mouse.
          if (
            (isVertical && (event.key === "ArrowLeft" || event.key === "ArrowRight")) ||
            (!isVertical && (event.key === "ArrowUp" || event.key === "ArrowDown"))
          ) {
            event.preventDefault();
            const delta =
              event.key === "ArrowLeft" || event.key === "ArrowUp" ? -0.02 : 0.02;
            const next = clampRatioForSize(ratio + delta, containerSize, minPanePx);
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
