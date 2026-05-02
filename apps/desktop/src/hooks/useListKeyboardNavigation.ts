import { useEffect } from "react";

interface ListKeyboardNavigationOptions<TId extends string> {
  /** Ordered list of item ids in the visible list. */
  itemIds: readonly TId[];
  /** Currently selected id, or undefined when nothing is selected. */
  selectedId: TId | undefined;
  /** Called when the user moves selection (arrow / j / k). */
  onSelect: (id: TId) => void;
  /**
   * Called when the user presses Enter on the selected row. Optional —
   * Enter is ignored when not provided (so forms inside the list aren't
   * disrupted).
   */
  onActivate?: (id: TId) => void;
  /**
   * When false, the hook is a no-op. Use this to disable navigation
   * while a modal is open or the list is offscreen.
   */
  enabled?: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  return target.isContentEditable;
}

/**
 * Page-scoped keyboard navigation for a list of selectable rows. Mounted
 * by the page that owns the list; unmounted with it. While mounted:
 *
 *   ↓ or j  →  next item   (wraps)
 *   ↑ or k  →  previous    (wraps)
 *   Enter   →  onActivate(selectedId)
 *
 * Skipped while the user is typing in an input, and while a modifier
 * (Cmd/Ctrl/Alt) is held — those combos belong to the global palette /
 * section-nav handlers.
 *
 * Selection state lives in the consuming page; this hook is a pure
 * keyboard adapter. If `selectedId` is missing, the first arrow press
 * selects the first item.
 *
 * Part of the keyboard-first follow-through from the QWEN review.
 */
export function useListKeyboardNavigation<TId extends string>({
  itemIds,
  selectedId,
  onSelect,
  onActivate,
  enabled = true,
}: ListKeyboardNavigationOptions<TId>) {
  useEffect(() => {
    if (!enabled || itemIds.length === 0) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }

      const goNext = event.key === "ArrowDown" || event.key === "j";
      const goPrev = event.key === "ArrowUp" || event.key === "k";
      const activate = event.key === "Enter" && Boolean(onActivate);

      if (!goNext && !goPrev && !activate) {
        return;
      }

      event.preventDefault();

      if (activate && selectedId !== undefined) {
        onActivate?.(selectedId);
        return;
      }

      const currentIndex = selectedId !== undefined ? itemIds.indexOf(selectedId) : -1;
      let nextIndex: number;
      if (currentIndex < 0) {
        // Nothing selected yet — first move lands on the first item
        // regardless of direction.
        nextIndex = 0;
      } else if (goNext) {
        nextIndex = (currentIndex + 1) % itemIds.length;
      } else {
        nextIndex = currentIndex <= 0 ? itemIds.length - 1 : currentIndex - 1;
      }

      onSelect(itemIds[nextIndex]);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled, itemIds, onActivate, onSelect, selectedId]);
}
