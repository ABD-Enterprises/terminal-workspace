import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelUndoWindow,
  expireUndoWindowNow,
  startUndoWindow,
} from "./undo-delete";

describe("undo-window timers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the expiry callback after the ttl", () => {
    const onExpire = vi.fn();
    startUndoWindow("a", 5_000, onExpire);

    vi.advanceTimersByTime(4_999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("cancel prevents the expiry callback", () => {
    const onExpire = vi.fn();
    startUndoWindow("b", 5_000, onExpire);
    cancelUndoWindow("b");

    vi.advanceTimersByTime(10_000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("replacing a window expires the previous one immediately", () => {
    const first = vi.fn();
    const second = vi.fn();
    startUndoWindow("c", 5_000, first);
    startUndoWindow("c", 5_000, second);

    expect(first).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("expireUndoWindowNow runs the callback once and only with a live window", () => {
    const onExpire = vi.fn();
    expireUndoWindowNow("d", onExpire);
    expect(onExpire).not.toHaveBeenCalled();

    startUndoWindow("d", 5_000, onExpire);
    expireUndoWindowNow("d", onExpire);
    expect(onExpire).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
