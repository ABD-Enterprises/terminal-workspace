import { useEffect } from "react";
import { useAppStore } from "../store/app-store";

// Returns true when the active element is something the user types into —
// an <input>, <textarea>, or contenteditable element. We use this to skip
// global keypress handlers that would otherwise eat the user's keystrokes
// (e.g. typing "?" into the host search field should not open the
// cheatsheet).
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (target.isContentEditable) {
    return true;
  }
  return false;
}

/**
 * Global keyboard cheatsheet hook. Press `?` (Shift+/) anywhere outside an
 * input to open the cheatsheet overlay; press `?` again or Esc to close.
 *
 * Skipped while typing in an input — `?` is part of normal text and we
 * never want the cheatsheet to steal it.
 *
 * Addresses the keyboard-first follow-through gap from the QWEN review:
 * users could already use ⌘K (palette) and ⌘1..6 (section nav), but had
 * no surface for discovering the keymap.
 */
export function useKeyboardCheatsheet() {
  const cheatsheetOpen = useAppStore((state) => state.cheatsheetOpen);
  const openCheatsheet = useAppStore((state) => state.openCheatsheet);
  const closeCheatsheet = useAppStore((state) => state.closeCheatsheet);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Esc always closes when open.
      if (event.key === "Escape" && cheatsheetOpen) {
        event.preventDefault();
        closeCheatsheet();
        return;
      }

      // `?` opens (or toggles) the cheatsheet, but only when the user
      // isn't actively typing somewhere. We also skip when a modifier
      // (Cmd/Ctrl/Alt) is held — those combos belong to other handlers.
      if (event.key !== "?") {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }

      event.preventDefault();
      if (cheatsheetOpen) {
        closeCheatsheet();
      } else {
        openCheatsheet();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [cheatsheetOpen, closeCheatsheet, openCheatsheet]);
}
