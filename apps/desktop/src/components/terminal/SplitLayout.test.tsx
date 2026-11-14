// @vitest-environment happy-dom
import { expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { SplitLayout } from "./SplitLayout";

// ---------------------------------------------------------------------------
// ResizeObserver mock. jsdom has no ResizeObserver; SplitLayout guards for
// that and falls back to ratio-only clamping. These tests install a
// controllable mock so the pixel-floor paths (#UX-1) can be exercised.
// ---------------------------------------------------------------------------

type ResizeCallback = (entries: Array<{ contentRect: { width: number; height: number } }>) => void;

let resizeCallback: ResizeCallback | null = null;

class ResizeObserverMock {
  constructor(callback: ResizeCallback) {
    resizeCallback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function emitContainerSize(width: number, height = 600) {
  act(() => {
    resizeCallback?.([{ contentRect: { width, height } }]);
  });
}

function renderTwoPanes(splitRatio?: number, onSplitRatioChange?: (ratio: number) => void) {
  const utils = render(
    <SplitLayout
      direction="vertical"
      panes={[<div key="a">A</div>, <div key="b">B</div>]}
      splitRatio={splitRatio}
      onSplitRatioChange={onSplitRatioChange}
    />
  );
  const separator = utils.container.querySelector<HTMLElement>('[role="separator"]');
  const grid = separator?.parentElement as HTMLElement;
  return { ...utils, separator: separator!, grid };
}

function gridTemplate(grid: HTMLElement): string {
  return grid.style.gridTemplateColumns;
}

beforeEach(() => {
  resizeCallback = null;
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("imports successfully", async () => {
  const mod = await import("./SplitLayout");
  expect(mod).toBeDefined();
});

it("renders the default 50/50 split when no measurement is available", () => {
  const { grid } = renderTwoPanes();
  expect(gridTemplate(grid)).toBe("0.5fr 6px 0.5fr");
});

it("clamps a small persisted ratio up to the pixel floor", () => {
  const { grid } = renderTwoPanes(0.05);
  emitContainerSize(800); // floor = 320px / 800px = 0.4
  expect(gridTemplate(grid)).toBe("0.4fr 6px 0.6fr");
});

it("clamps a large persisted ratio down to the pixel floor", () => {
  const { grid } = renderTwoPanes(0.97);
  emitContainerSize(800); // ceil = 1 - 0.4 = 0.6
  expect(gridTemplate(grid)).toBe("0.6fr 6px 0.4fr");
});

it("ignores the pixel floor until the container has been measured", () => {
  const { grid } = renderTwoPanes(0.2);
  expect(gridTemplate(grid)).toBe("0.2fr 6px 0.8fr");
  emitContainerSize(1600); // 0.2 * 1600 = 320px — exactly at the floor, kept
  expect(gridTemplate(grid)).toBe("0.2fr 6px 0.8fr");
});

it("splits evenly when the container cannot fit two minimum panes", () => {
  const { grid } = renderTwoPanes(0.1);
  emitContainerSize(600); // 2 * 320px minimum > 600px
  expect(gridTemplate(grid)).toBe("0.5fr 6px 0.5fr");
});

it("exposes the pixel floor as the separator's ARIA bounds", () => {
  const { separator } = renderTwoPanes();
  emitContainerSize(800);
  expect(separator.getAttribute("aria-valuemin")).toBe("40");
  expect(separator.getAttribute("aria-valuemax")).toBe("60");
});

it("clamps mouse drags to the pixel floor", () => {
  const onSplitRatioChange = vi.fn();
  const { separator, grid } = renderTwoPanes(0.5, onSplitRatioChange);
  vi.spyOn(grid, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    right: 800,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);

  fireEvent.mouseDown(separator);
  fireEvent.mouseMove(window, { clientX: 10, clientY: 0 }); // 10/800 = 1.25% — far below the floor
  fireEvent.mouseUp(window);

  expect(onSplitRatioChange).toHaveBeenCalledWith(0.4);
});

it("keeps keyboard nudges inside the pixel floor", () => {
  const onSplitRatioChange = vi.fn();
  const { separator } = renderTwoPanes(0.4, onSplitRatioChange);
  emitContainerSize(800); // floor 0.4 — nudging left must not go below it
  fireEvent.keyDown(separator, { key: "ArrowLeft" });
  expect(onSplitRatioChange).toHaveBeenCalledWith(0.4);
});
