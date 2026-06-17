// Floating overlay listing every keyboard shortcut the app exposes.
// Triggered by `?` (handled in useKeyboardCheatsheet); also closeable
// with Esc or by clicking outside. See internal/parity-and-hardening-review
// — the keyboard-first follow-through item from QWEN's review noted that
// while ⌘K and ⌘1..6 worked, there was no discovery surface for the
// keymap. This is that surface.
//
// If you add a new global keybinding, add it to the SECTIONS array below
// so the user can find it.

import { isMacClient } from "../../lib/shortcuts";
import { useAppStore } from "../../store/app-store";
import { Modal } from "./Modal";

interface ShortcutEntry {
  keys: string[];
  description: string;
}

interface ShortcutSection {
  title: string;
  entries: ShortcutEntry[];
}

function buildSections(): ShortcutSection[] {
  const mod = isMacClient() ? "⌘" : "Ctrl";
  return [
    {
      title: "Global",
      entries: [
        { keys: [`${mod}K`], description: "Open the command palette" },
        { keys: ["?"], description: "Show this cheatsheet" },
        { keys: ["Esc"], description: "Close any open dialog or palette" },
      ],
    },
    {
      title: "Section navigation",
      entries: [
        { keys: [`${mod}1`], description: "Hosts" },
        { keys: [`${mod}2`], description: "Sessions" },
        { keys: [`${mod}3`], description: "Snippets" },
        { keys: [`${mod}4`], description: "Keys" },
        { keys: [`${mod}5`], description: "Transfers" },
        { keys: [`${mod}6`], description: "Settings" },
      ],
    },
    {
      title: "Lists",
      entries: [
        { keys: ["↓", "j"], description: "Move selection down" },
        { keys: ["↑", "k"], description: "Move selection up" },
        { keys: ["Enter"], description: "Activate the selected row" },
      ],
    },
    {
      title: "Dialogs",
      entries: [
        { keys: ["Enter"], description: "Confirm the primary action" },
        { keys: ["Esc"], description: "Cancel and close" },
      ],
    },
  ];
}

export function KeyboardCheatsheet() {
  const open = useAppStore((state) => state.cheatsheetOpen);
  const close = useAppStore((state) => state.closeCheatsheet);

  if (!open) {
    return null;
  }

  const sections = buildSections();

  return (
    <Modal
      open={open}
      title="Keyboard shortcuts"
      description="Press ? to toggle this list. Skipped while typing in an input."
      onClose={close}
      footer={
        <div className="flex justify-end">
          <button
            type="button"
            onClick={close}
            className="rounded-2xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Close
          </button>
        </div>
      }
    >
      <div className="grid gap-6 md:grid-cols-2">
        {sections.map((section) => (
          <section key={section.title} aria-label={section.title}>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300">
              {section.title}
            </h3>
            <ul className="mt-2 space-y-1.5">
              {section.entries.map((entry) => (
                <li
                  key={`${section.title}:${entry.description}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2"
                >
                  <span className="text-sm text-slate-200">{entry.description}</span>
                  <span className="flex items-center gap-1">
                    {entry.keys.map((key, idx) => (
                      <span key={`${entry.description}:${key}:${idx}`} className="flex items-center gap-1">
                        {idx > 0 ? <span className="text-xs text-slate-500">or</span> : null}
                        <kbd className="rounded-md border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] font-mono text-slate-200">
                          {key}
                        </kbd>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
