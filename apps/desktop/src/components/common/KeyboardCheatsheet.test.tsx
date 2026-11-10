// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/app-store";
import { KeyboardCheatsheet } from "./KeyboardCheatsheet";

// #464 / #460: the shortcut glyphs follow the platform. These pin the
// formatter KeyboardCheatsheet uses, so reverting it to Mac-only glyphs (or
// dropping the "+") fails a test.

function renderOnPlatform(platform: string) {
  vi.stubGlobal("navigator", { ...navigator, platform });
  useAppStore.setState({ cheatsheetOpen: true });
  render(<KeyboardCheatsheet />);
  return Array.from(document.querySelectorAll("kbd")).map((key) => key.textContent);
}

describe("KeyboardCheatsheet shortcut glyphs", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useAppStore.setState({ cheatsheetOpen: false });
  });

  it("shows Ctrl+ shortcuts on Windows and Linux", () => {
    const keys = renderOnPlatform("Win32");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(keys).toContain("Ctrl+K");
    expect(keys).toContain("Ctrl+1");
    expect(keys).not.toContain("CtrlK");
    expect(keys).not.toContain("Ctrl1");
    expect(keys.some((key) => key?.includes("⌘"))).toBe(false);
  });

  it("shows ⌘ shortcuts on a Mac", () => {
    const keys = renderOnPlatform("MacIntel");
    expect(keys).toContain("⌘K");
    expect(keys).not.toContain("Ctrl+K");
  });
});
