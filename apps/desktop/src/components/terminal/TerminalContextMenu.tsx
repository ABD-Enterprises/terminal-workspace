// #507: the terminal's right-click menu. Right-click used to paste the
// clipboard straight into the live shell with no menu and no confirmation;
// now nothing reaches the session unless the user picks Paste.
//
// Positioned at the cursor. Copy (disabled with no selection), Paste and
// Clear. Clear only clears this pane's screen and scrollback; it sends nothing
// to the remote shell. Arrow keys, Home and End move between items, Enter or
// Space picks one, Escape and an outside click close the menu, and focus
// returns to the terminal when it closes.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { type TerminalContextMenuPosition } from "./terminal-pane-input-wiring";

interface TerminalContextMenuProps {
  position: TerminalContextMenuPosition | null;
  hasSelection: boolean;
  onCopy: () => void;
  onPaste: () => void;
  onClear: () => void;
  onClose: () => void;
}

/** Gap kept between the menu and the window edge. */
const VIEWPORT_MARGIN = 4;

/**
 * Keep the menu inside the window: a right-click near the bottom or right edge
 * would otherwise place its lower or right items off-screen.
 */
export function clampMenuPosition(
  position: TerminalContextMenuPosition,
  size: { width: number; height: number },
  viewport: { width: number; height: number }
): TerminalContextMenuPosition {
  const maxX = viewport.width - size.width - VIEWPORT_MARGIN;
  const maxY = viewport.height - size.height - VIEWPORT_MARGIN;
  return {
    x: Math.max(VIEWPORT_MARGIN, Math.min(position.x, maxX)),
    y: Math.max(VIEWPORT_MARGIN, Math.min(position.y, maxY)),
  };
}

interface MenuItem {
  label: string;
  disabled: boolean;
  run: () => void;
}

export function TerminalContextMenu({
  position,
  hasSelection,
  onCopy,
  onPaste,
  onClear,
  onClose,
}: TerminalContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState<TerminalContextMenuPosition | null>(null);

  // Measure before paint and move the menu inside the window if needed.
  useLayoutEffect(() => {
    if (!position || !menuRef.current) {
      setPlaced(null);
      return;
    }
    const rect = menuRef.current.getBoundingClientRect();
    setPlaced(
      clampMenuPosition(
        position,
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  }, [position]);

  // Focus the first enabled item when the menu opens.
  useEffect(() => {
    if (!position) {
      return;
    }
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
      ?.focus();
  }, [position]);

  // Close on an outside press. mousedown, not click, so the dismissal happens
  // before whatever is beneath reacts to the same press.
  useEffect(() => {
    if (!position) {
      return;
    }
    const onMouseDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [onClose, position]);

  if (!position) {
    return null;
  }

  const items: MenuItem[] = [
    { label: "Copy", disabled: !hasSelection, run: onCopy },
    { label: "Paste", disabled: false, run: onPaste },
    { label: "Clear", disabled: false, run: onClear },
  ];

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const enabled = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ??
        []
    );
    if (enabled.length === 0) {
      return;
    }
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = current < 0 ? 0 : (current + 1) % enabled.length;
        break;
      case "ArrowUp":
        next = current <= 0 ? enabled.length - 1 : current - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = enabled.length - 1;
        break;
      case "Escape":
      case "Tab":
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      default:
        return;
    }
    event.preventDefault();
    enabled[next]?.focus();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Terminal actions"
      onKeyDown={onKeyDown}
      className="fixed z-50 min-w-[160px] rounded-2xl border border-slate-700 bg-slate-900/95 p-1 shadow-2xl backdrop-blur"
      style={{ left: (placed ?? position).x, top: (placed ?? position).y }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            item.run();
            onClose();
          }}
          className="block w-full rounded-xl px-3 py-1.5 text-left text-xs text-slate-200 transition hover:bg-slate-800 focus:bg-slate-800 focus:outline-none disabled:cursor-not-allowed disabled:text-slate-500 disabled:hover:bg-transparent"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
