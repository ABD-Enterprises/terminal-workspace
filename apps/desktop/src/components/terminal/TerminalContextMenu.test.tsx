// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clampMenuPosition, TerminalContextMenu } from "./TerminalContextMenu";

function renderMenu(hasSelection = true) {
  const handlers = {
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onClear: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <TerminalContextMenu position={{ x: 10, y: 20 }} hasSelection={hasSelection} {...handlers} />
  );
  return handlers;
}

describe("TerminalContextMenu (#507)", () => {
  afterEach(cleanup);

  it("renders nothing when closed", () => {
    const { container } = render(
      <TerminalContextMenu
        position={null}
        hasSelection={false}
        onCopy={vi.fn()}
        onPaste={vi.fn()}
        onClear={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("is a menu of Copy, Paste and Clear, focused on the first item", () => {
    renderMenu();
    expect(screen.getByRole("menu", { name: "Terminal actions" })).toBeDefined();
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toEqual(["Copy", "Paste", "Clear"]);
    expect(document.activeElement?.textContent).toBe("Copy");
  });

  it("disables Copy with no selection and focuses Paste instead", () => {
    const handlers = renderMenu(false);
    const copy = screen.getByRole("menuitem", { name: "Copy" });
    expect(copy.hasAttribute("disabled")).toBe(true);
    expect(document.activeElement?.textContent).toBe("Paste");
    fireEvent.click(copy);
    expect(handlers.onCopy).not.toHaveBeenCalled();
  });

  it("runs only the item picked, then closes and returns focus", () => {
    const handlers = renderMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Paste" }));
    expect(handlers.onPaste).toHaveBeenCalledTimes(1);
    expect(handlers.onCopy).not.toHaveBeenCalled();
    expect(handlers.onClear).not.toHaveBeenCalled();
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenLastCalledWith({ restoreFocus: true });
  });

  it("renders at the top level of the page, outside any filtered ancestor", () => {
    const host = document.createElement("div");
    host.style.backdropFilter = "blur(4px)";
    document.body.appendChild(host);
    render(
      <TerminalContextMenu
        position={{ x: 10, y: 20 }}
        hasSelection
        onCopy={vi.fn()}
        onPaste={vi.fn()}
        onClear={vi.fn()}
        onClose={vi.fn()}
      />,
      { container: host }
    );
    expect(screen.getByRole("menu").parentElement).toBe(document.body);
    host.remove();
  });

  it("moves with the arrow keys, Home and End, and wraps", () => {
    renderMenu();
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Paste");
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement?.textContent).toBe("Clear");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Copy");
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toBe("Clear");
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement?.textContent).toBe("Copy");
  });

  it("closes on Escape and on a press outside, without running anything", () => {
    const handlers = renderMenu();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(handlers.onClose).toHaveBeenLastCalledWith({ restoreFocus: true });
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    fireEvent.mouseDown(elsewhere);
    expect(handlers.onClose).toHaveBeenCalledTimes(2);
    // Another pane may have just taken focus; do not take it back.
    expect(handlers.onClose).toHaveBeenLastCalledWith({ restoreFocus: false });
    elsewhere.remove();
    expect(handlers.onPaste).not.toHaveBeenCalled();
    expect(handlers.onCopy).not.toHaveBeenCalled();
    expect(handlers.onClear).not.toHaveBeenCalled();
  });

  it("stays inside the window when opened near the bottom-right corner", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 160,
      height: 100,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 160,
      bottom: 100,
      toJSON: () => ({}),
    } as DOMRect);
    render(
      <TerminalContextMenu
        position={{ x: window.innerWidth - 5, y: window.innerHeight - 5 }}
        hasSelection
        onCopy={vi.fn()}
        onPaste={vi.fn()}
        onClear={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const menu = screen.getByRole("menu");
    expect(parseFloat(menu.style.left)).toBeLessThanOrEqual(window.innerWidth - 160);
    expect(parseFloat(menu.style.top)).toBeLessThanOrEqual(window.innerHeight - 100);
    vi.restoreAllMocks();
  });
});

describe("clampMenuPosition", () => {
  const viewport = { width: 800, height: 600 };
  const size = { width: 160, height: 100 };

  it("leaves a position with room unchanged", () => {
    expect(clampMenuPosition({ x: 100, y: 120 }, size, viewport)).toEqual({ x: 100, y: 120 });
  });

  it("pulls the menu back from the right and bottom edges", () => {
    expect(clampMenuPosition({ x: 790, y: 590 }, size, viewport)).toEqual({ x: 636, y: 496 });
  });

  it("never goes past the top-left margin, even in a tiny window", () => {
    expect(clampMenuPosition({ x: 10, y: 10 }, size, { width: 100, height: 80 })).toEqual({
      x: 4,
      y: 4,
    });
  });
});
