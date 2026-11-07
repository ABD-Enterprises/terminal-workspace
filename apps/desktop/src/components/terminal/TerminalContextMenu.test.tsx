// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalContextMenu } from "./TerminalContextMenu";

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

  it("runs only the item picked, then closes", () => {
    const handlers = renderMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Paste" }));
    expect(handlers.onPaste).toHaveBeenCalledTimes(1);
    expect(handlers.onCopy).not.toHaveBeenCalled();
    expect(handlers.onClear).not.toHaveBeenCalled();
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
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
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.body);
    expect(handlers.onClose).toHaveBeenCalledTimes(2);
    expect(handlers.onPaste).not.toHaveBeenCalled();
    expect(handlers.onCopy).not.toHaveBeenCalled();
    expect(handlers.onClear).not.toHaveBeenCalled();
  });
});
