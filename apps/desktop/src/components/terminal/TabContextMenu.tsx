// Floating right-click menu for terminal tabs. T08.
//
// Positioned at the cursor on right-click. Four actions:
//   - Close              — close the clicked tab
//   - Close others       — close every other tab, keep the clicked one
//   - Close to the right — close tabs after the clicked one in display
//                          order
//   - Duplicate          — open a new session for the same host
//
// Closes on Esc and on outside-click. The parent owns the open state
// + the {tabId, x, y} payload; this component is just the menu UI.

import { useEffect, useRef } from "react";

export interface TabContextMenuPayload {
  tabId: string;
  x: number;
  y: number;
}

interface TabContextMenuProps {
  payload: TabContextMenuPayload | null;
  onClose: () => void;
  onCloseTab: (tabId: string) => void;
  onCloseOthers: (tabId: string) => void;
  onCloseToRight: (tabId: string) => void;
  onDuplicate: (tabId: string) => void;
}

export function TabContextMenu({
  payload,
  onClose,
  onCloseTab,
  onCloseOthers,
  onCloseToRight,
  onDuplicate,
}: TabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close on Esc.
  useEffect(() => {
    if (!payload) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, payload]);

  // Close on outside-click. We hook on mousedown rather than click so
  // the dismissal happens before a button beneath registers its own
  // click (avoids accidentally opening another menu in the same press).
  useEffect(() => {
    if (!payload) {
      return;
    }
    const onMouseDown = (event: MouseEvent) => {
      if (!menuRef.current) {
        return;
      }
      if (!menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [onClose, payload]);

  if (!payload) {
    return null;
  }

  const items: Array<{ label: string; onClick: () => void }> = [
    {
      label: "Close",
      onClick: () => {
        onCloseTab(payload.tabId);
        onClose();
      },
    },
    {
      label: "Close others",
      onClick: () => {
        onCloseOthers(payload.tabId);
        onClose();
      },
    },
    {
      label: "Close to the right",
      onClick: () => {
        onCloseToRight(payload.tabId);
        onClose();
      },
    },
    {
      label: "Duplicate",
      onClick: () => {
        onDuplicate(payload.tabId);
        onClose();
      },
    },
  ];

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Tab actions"
      style={{ left: payload.x, top: payload.y }}
      className="fixed z-50 min-w-[180px] rounded-xl border border-slate-700 bg-slate-900 py-1 shadow-2xl shadow-slate-950/70"
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={item.onClick}
          className="block w-full px-3 py-1.5 text-left text-sm text-slate-200 transition hover:bg-slate-800 hover:text-white"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
