// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastViewport } from "./ToastViewport";
import { pushToast, useToastStore } from "../../store/toast-store";

describe("ToastViewport", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the toast message and runs the action on Undo", () => {
    const run = vi.fn();
    render(<ToastViewport />);

    act(() => {
      pushToast({ message: 'Deleted snippet "Nightly restart"', durationMs: 60_000, action: { label: "Undo", run } });
    });

    expect(screen.getByText('Deleted snippet "Nightly restart"')).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(run).toHaveBeenCalledTimes(1);
    // Acting on the toast dismisses it.
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("dismisses via the close button without running the action", () => {
    const run = vi.fn();
    render(<ToastViewport />);

    act(() => {
      pushToast({ message: "Deleted key", durationMs: 60_000, action: { label: "Undo", run } });
    });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));

    expect(run).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
