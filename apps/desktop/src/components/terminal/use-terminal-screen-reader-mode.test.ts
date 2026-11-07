// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../store/app-store";
import { useTerminalScreenReaderMode } from "./use-terminal-screen-reader-mode";

describe("useTerminalScreenReaderMode (#510)", () => {
  afterEach(() => {
    useAppStore.setState({ terminalScreenReaderMode: false });
  });

  it("applies the setting to an already-open terminal, both ways", () => {
    const terminalRef = { current: { options: { screenReaderMode: false } } };
    renderHook(() => useTerminalScreenReaderMode(terminalRef as never));
    expect(terminalRef.current.options.screenReaderMode).toBe(false);

    act(() => useAppStore.getState().setTerminalScreenReaderMode(true));
    expect(terminalRef.current.options.screenReaderMode).toBe(true);

    act(() => useAppStore.getState().setTerminalScreenReaderMode(false));
    expect(terminalRef.current.options.screenReaderMode).toBe(false);
  });

  it("does nothing before the terminal exists", () => {
    const terminalRef = { current: null };
    useAppStore.setState({ terminalScreenReaderMode: true });
    expect(() => renderHook(() => useTerminalScreenReaderMode(terminalRef))).not.toThrow();
  });
});
