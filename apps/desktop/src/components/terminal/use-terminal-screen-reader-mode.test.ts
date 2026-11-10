// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../store/app-store";
import { useTerminalScreenReaderMode } from "./use-terminal-screen-reader-mode";

describe("useTerminalScreenReaderMode (#510)", () => {
  afterEach(() => {
    useAppStore.setState({ terminalScreenReaderMode: false });
  });

  it("applies the setting to an already-open active terminal, both ways", () => {
    const terminalRef = { current: { options: { screenReaderMode: false } } };
    renderHook(() => useTerminalScreenReaderMode(terminalRef as never, { current: false }, true));
    expect(terminalRef.current.options.screenReaderMode).toBe(false);

    act(() => useAppStore.getState().setTerminalScreenReaderMode(true));
    expect(terminalRef.current.options.screenReaderMode).toBe(true);

    act(() => useAppStore.getState().setTerminalScreenReaderMode(false));
    expect(terminalRef.current.options.screenReaderMode).toBe(false);
  });

  it("keeps a background pane quiet and follows the pane as it becomes active", () => {
    useAppStore.setState({ terminalScreenReaderMode: true });
    const terminalRef = { current: { options: { screenReaderMode: true } } };
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useTerminalScreenReaderMode(terminalRef as never, { current: false }, active),
      { initialProps: { active: false } }
    );
    expect(terminalRef.current.options.screenReaderMode).toBe(false);
    rerender({ active: true });
    expect(terminalRef.current.options.screenReaderMode).toBe(true);
    rerender({ active: false });
    expect(terminalRef.current.options.screenReaderMode).toBe(false);
  });

  it("does nothing before the terminal exists", () => {
    const terminalRef = { current: null };
    useAppStore.setState({ terminalScreenReaderMode: true });
    expect(() => renderHook(() => useTerminalScreenReaderMode(terminalRef, { current: false }, true))).not.toThrow();
  });

  it("keeps the mode for a terminal the lifecycle creates later, and reports when the terminal speaks", () => {
    useAppStore.setState({ terminalScreenReaderMode: true });
    const modeRef = { current: false };
    const terminalRef = { current: null };
    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useTerminalScreenReaderMode(terminalRef, modeRef, active),
      { initialProps: { active: true } }
    );
    expect(modeRef.current).toBe(true);
    expect(result.current).toBe(true);
    rerender({ active: false });
    expect(modeRef.current).toBe(false);
    expect(result.current).toBe(false);
  });
});
