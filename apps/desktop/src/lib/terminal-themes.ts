// Built-in terminal colour themes.
//
// Until 2026-04-27 the terminal palette was hardcoded inside `TerminalPane.tsx`
// (slate background, emerald accent), which meant power users could not pick a
// font / theme combo and the terminal ignored the OS dark/light setting. This
// module is the single source of truth for terminal colours so:
//   - `TerminalPane` consumes a palette and ANSI colour map by name.
//   - The Settings page can offer a picker without coupling to xterm internals.
//   - The "auto" mode tracks the OS `prefers-color-scheme` query.
// See internal/parity-and-hardening-plan.md P1-UX7 and review §4.4.

/**
 * The shape xterm.js expects on `terminal.options.theme`. We do not import the
 * xterm types here so this module stays plain TS without the addon dep tree.
 */
export interface TerminalAnsiPalette {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent?: string;
  selectionBackground?: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export type TerminalThemeMode = "dark" | "light";

/** Catalogue of named themes plus the `auto` sentinel. */
export const TERMINAL_THEME_NAMES = [
  "auto",
  "slate-emerald",
  "solarized-dark",
  "solarized-light",
  "monokai",
  "nord",
  "high-contrast-light",
] as const;

export type TerminalThemeName = (typeof TERMINAL_THEME_NAMES)[number];

export const DEFAULT_TERMINAL_THEME: TerminalThemeName = "auto";

/** A single concrete theme entry. `auto` is not in this map; it resolves at runtime. */
interface TerminalThemeEntry {
  label: string;
  description: string;
  mode: TerminalThemeMode;
  palette: TerminalAnsiPalette;
}

const themes: Record<Exclude<TerminalThemeName, "auto">, TerminalThemeEntry> = {
  "slate-emerald": {
    label: "Slate Emerald",
    description: "Default dark palette inherited from term-snip 0.1 — slate background, emerald accent.",
    mode: "dark",
    palette: {
      background: "#08101a",
      foreground: "#ebf2ff",
      cursor: "#76e4c3",
      black: "#0b1220",
      brightBlack: "#6b7280",
      brightBlue: "#93c5fd",
      brightCyan: "#67e8f9",
      brightGreen: "#86efac",
      brightMagenta: "#f0abfc",
      brightRed: "#fda4af",
      brightWhite: "#ffffff",
      brightYellow: "#fde68a",
      blue: "#60a5fa",
      cyan: "#22d3ee",
      green: "#4ade80",
      magenta: "#e879f9",
      red: "#fb7185",
      white: "#e2e8f0",
      yellow: "#facc15",
    },
  },
  "solarized-dark": {
    label: "Solarized Dark",
    description: "Ethan Schoonover's Solarized palette, dark variant.",
    mode: "dark",
    palette: {
      background: "#002b36",
      foreground: "#839496",
      cursor: "#93a1a1",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#586e75",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
  },
  "solarized-light": {
    label: "Solarized Light",
    description: "Solarized light variant; pairs with macOS light mode.",
    mode: "light",
    palette: {
      background: "#fdf6e3",
      foreground: "#657b83",
      cursor: "#586e75",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#002b36",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
  },
  monokai: {
    label: "Monokai",
    description: "High-contrast dark theme popular for code editors.",
    mode: "dark",
    palette: {
      background: "#272822",
      foreground: "#f8f8f2",
      cursor: "#f8f8f0",
      black: "#272822",
      red: "#f92672",
      green: "#a6e22e",
      yellow: "#f4bf75",
      blue: "#66d9ef",
      magenta: "#ae81ff",
      cyan: "#a1efe4",
      white: "#f8f8f2",
      brightBlack: "#75715e",
      brightRed: "#f92672",
      brightGreen: "#a6e22e",
      brightYellow: "#f4bf75",
      brightBlue: "#66d9ef",
      brightMagenta: "#ae81ff",
      brightCyan: "#a1efe4",
      brightWhite: "#f9f8f5",
    },
  },
  nord: {
    label: "Nord",
    description: "Cool, balanced dark theme based on the Nord palette.",
    mode: "dark",
    palette: {
      background: "#2e3440",
      foreground: "#d8dee9",
      cursor: "#88c0d0",
      black: "#3b4252",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightBlack: "#4c566a",
      brightRed: "#bf616a",
      brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1",
      brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb",
      brightWhite: "#eceff4",
    },
  },
  "high-contrast-light": {
    label: "High Contrast Light",
    description: "Black-on-white with saturated accents; tuned for readability in bright rooms.",
    mode: "light",
    palette: {
      background: "#ffffff",
      foreground: "#101418",
      cursor: "#0f172a",
      black: "#000000",
      red: "#b91c1c",
      green: "#047857",
      yellow: "#a16207",
      blue: "#1d4ed8",
      magenta: "#9d174d",
      cyan: "#0e7490",
      white: "#e5e7eb",
      brightBlack: "#475569",
      brightRed: "#dc2626",
      brightGreen: "#059669",
      brightYellow: "#ca8a04",
      brightBlue: "#2563eb",
      brightMagenta: "#be185d",
      brightCyan: "#0891b2",
      brightWhite: "#0f172a",
    },
  },
};

/** Default theme used inside `auto` for each mode. Kept stable for migrations. */
const AUTO_DEFAULTS: Record<TerminalThemeMode, Exclude<TerminalThemeName, "auto">> = {
  dark: "slate-emerald",
  light: "high-contrast-light",
};

/**
 * Return the concrete palette to apply to xterm. `themeName === "auto"`
 * resolves through the supplied OS color scheme; an unrecognised name falls
 * through to the slate-emerald default rather than throwing — the terminal
 * is rendered every frame, we never want it to crash on a stale persisted
 * value.
 */
export function resolveTerminalTheme(
  themeName: TerminalThemeName,
  prefersColorScheme: TerminalThemeMode = "dark"
): { name: Exclude<TerminalThemeName, "auto">; entry: TerminalThemeEntry } {
  if (themeName === "auto") {
    const resolvedName = AUTO_DEFAULTS[prefersColorScheme];
    return { name: resolvedName, entry: themes[resolvedName] };
  }
  if (!isKnownTheme(themeName)) {
    return { name: "slate-emerald", entry: themes["slate-emerald"] };
  }
  return { name: themeName, entry: themes[themeName] };
}

export function isKnownTheme(value: unknown): value is TerminalThemeName {
  return (
    typeof value === "string" &&
    (TERMINAL_THEME_NAMES as readonly string[]).includes(value)
  );
}

export interface TerminalThemeOption {
  name: TerminalThemeName;
  label: string;
  description: string;
  mode: TerminalThemeMode | "auto";
  preview: { background: string; foreground: string; accent: string };
}

/** Small preview swatch for each theme so the picker can render without asking xterm. */
export function listTerminalThemeOptions(): TerminalThemeOption[] {
  const named: TerminalThemeOption[] = (
    Object.keys(themes) as Array<Exclude<TerminalThemeName, "auto">>
  ).map((name) => {
    const entry = themes[name];
    return {
      name,
      label: entry.label,
      description: entry.description,
      mode: entry.mode,
      preview: {
        background: entry.palette.background,
        foreground: entry.palette.foreground,
        accent: entry.palette.cursor,
      },
    };
  });

  // The "auto" option leads the list because it is the recommended default.
  const autoLight = themes[AUTO_DEFAULTS.light];
  const autoDark = themes[AUTO_DEFAULTS.dark];
  const autoOption: TerminalThemeOption = {
    name: "auto",
    label: "Auto (match system)",
    description: `Light → ${autoLight.label}, Dark → ${autoDark.label}.`,
    mode: "auto",
    preview: {
      background: autoDark.palette.background,
      foreground: autoLight.palette.background,
      accent: autoDark.palette.cursor,
    },
  };
  return [autoOption, ...named];
}

/**
 * Read the current OS color-scheme preference. Returns `"dark"` outside of a
 * browser environment (SSR / Node test env) so callers always get a defined
 * value.
 */
export function detectSystemColorScheme(): TerminalThemeMode {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
