import { useEffect, useRef } from "react";
import { hasCommandModifier, isTypingTarget } from "../lib/dom-events";

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
  const itemIdsRef = useRef(itemIds);
  const selectedIdRef = useRef(selectedId);

  useEffect(() => {
    itemIdsRef.current = itemIds;
  }, [itemIds]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const currentItemIds = itemIdsRef.current;
      if (currentItemIds.length === 0) {
        return;
      }
      if (hasCommandModifier(event)) {
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

      const currentSelectedId = selectedIdRef.current;
      if (activate && currentSelectedId !== undefined) {
        onActivate?.(currentSelectedId);
        return;
      }

      const currentIndex =
        currentSelectedId !== undefined ? currentItemIds.indexOf(currentSelectedId) : -1;
      let nextIndex: number;
      if (currentIndex < 0) {
        // Nothing selected yet — first move lands on the first item
        // regardless of direction.
        nextIndex = 0;
      } else if (goNext) {
        nextIndex = (currentIndex + 1) % currentItemIds.length;
      } else {
        nextIndex = currentIndex <= 0 ? currentItemIds.length - 1 : currentIndex - 1;
      }

      const nextId = currentItemIds[nextIndex];
      selectedIdRef.current = nextId;
      onSelect(nextId);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled, onActivate, onSelect]);
}
