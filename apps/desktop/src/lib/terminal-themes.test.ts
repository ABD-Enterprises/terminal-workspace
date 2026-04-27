import { describe, expect, it } from "vitest";
import {
  DEFAULT_TERMINAL_THEME,
  TERMINAL_THEME_NAMES,
  detectSystemColorScheme,
  isKnownTheme,
  listTerminalThemeOptions,
  resolveTerminalTheme,
} from "./terminal-themes";

describe("terminal-themes", () => {
  it("DEFAULT_TERMINAL_THEME is one of the listed names", () => {
    expect(TERMINAL_THEME_NAMES).toContain(DEFAULT_TERMINAL_THEME);
  });

  it("isKnownTheme accepts catalogued names and rejects others", () => {
    for (const name of TERMINAL_THEME_NAMES) {
      expect(isKnownTheme(name)).toBe(true);
    }
    expect(isKnownTheme("not-a-theme")).toBe(false);
    expect(isKnownTheme(undefined)).toBe(false);
    expect(isKnownTheme(null)).toBe(false);
    expect(isKnownTheme(42)).toBe(false);
  });

  describe("resolveTerminalTheme", () => {
    it("resolves a concrete theme by name regardless of prefers-color-scheme", () => {
      const dark = resolveTerminalTheme("monokai", "dark");
      const light = resolveTerminalTheme("monokai", "light");
      expect(dark.name).toBe("monokai");
      expect(light.name).toBe("monokai");
      expect(dark.entry.palette.background).toBe(light.entry.palette.background);
    });

    it("auto picks a dark default when prefers-color-scheme is dark", () => {
      const result = resolveTerminalTheme("auto", "dark");
      expect(result.entry.mode).toBe("dark");
    });

    it("auto picks a light default when prefers-color-scheme is light", () => {
      const result = resolveTerminalTheme("auto", "light");
      expect(result.entry.mode).toBe("light");
    });

    it("falls back to slate-emerald when given an unknown name", () => {
      // Forcing a stale persisted value through the type system.
      const result = resolveTerminalTheme(
        "not-a-theme" as unknown as Parameters<typeof resolveTerminalTheme>[0],
        "dark"
      );
      expect(result.name).toBe("slate-emerald");
    });

    it("returns a palette whose required ANSI fields are populated", () => {
      const result = resolveTerminalTheme("nord", "dark");
      const palette = result.entry.palette;
      const required: (keyof typeof palette)[] = [
        "background",
        "foreground",
        "cursor",
        "black",
        "red",
        "green",
        "yellow",
        "blue",
        "magenta",
        "cyan",
        "white",
        "brightBlack",
        "brightRed",
        "brightGreen",
        "brightYellow",
        "brightBlue",
        "brightMagenta",
        "brightCyan",
        "brightWhite",
      ];
      for (const key of required) {
        const value = palette[key];
        expect(typeof value).toBe("string");
        expect(value).toMatch(/^#/);
      }
    });
  });

  describe("listTerminalThemeOptions", () => {
    it("starts with the auto option and includes every named theme exactly once", () => {
      const options = listTerminalThemeOptions();
      expect(options[0]?.name).toBe("auto");
      const names = options.map((option) => option.name).sort();
      const expected = [...TERMINAL_THEME_NAMES].sort();
      expect(names).toEqual(expected);
    });

    it("each option carries a usable preview triplet", () => {
      for (const option of listTerminalThemeOptions()) {
        expect(option.preview.background).toMatch(/^#/);
        expect(option.preview.foreground).toMatch(/^#/);
        expect(option.preview.accent).toMatch(/^#/);
      }
    });
  });

  describe("detectSystemColorScheme", () => {
    it("returns 'dark' when window or matchMedia is unavailable", () => {
      // The vitest test env uses node, so window is undefined here.
      expect(detectSystemColorScheme()).toBe("dark");
    });
  });
});
