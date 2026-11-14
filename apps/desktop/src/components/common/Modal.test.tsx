// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal } from "./Modal";

describe("Modal", () => {
  afterEach(() => {
    cleanup();
  });

  it("imports successfully", async () => {
    const mod = await import("./Modal");
    expect(mod).toBeDefined();
  });

  it("wires aria-labelledby and aria-describedby to title and description elements (#508)", () => {
    render(
      <Modal
        open={true}
        title="Edit Host Details"
        description="Configure SSH connection parameters and keys."
        onClose={vi.fn()}
      >
        <div>Modal Content</div>
      </Modal>
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeDefined();

    const titleElement = screen.getByText("Edit Host Details");
    expect(titleElement.id).toBeTruthy();
    expect(dialog.getAttribute("aria-labelledby")).toBe(titleElement.id);

    const descElement = screen.getByText("Configure SSH connection parameters and keys.");
    expect(descElement.id).toBeTruthy();
    expect(dialog.getAttribute("aria-describedby")).toBe(descElement.id);
  });

  it("leaves aria-describedby undefined when no description is passed", () => {
    render(
      <Modal
        open={true}
        title="Simple Title"
        onClose={vi.fn()}
      >
        <div>Content</div>
      </Modal>
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-describedby")).toBeNull();
  });

  it("moves initial focus into the dialog on open and traps Tab navigation (#505)", () => {
    function TestComponent() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Open Dialog Trigger
          </button>
          <Modal
            open={open}
            title="Focus Trap Dialog"
            onClose={() => setOpen(false)}
            footer={
              <div>
                <button type="button">Action A</button>
                <button type="button">Action B</button>
              </div>
            }
          >
            <div>
              <input type="text" placeholder="First input" />
            </div>
          </Modal>
        </div>
      );
    }

    render(<TestComponent />);

    const trigger = screen.getByRole("button", { name: "Open Dialog Trigger" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    // Open the modal
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeDefined();

    // Verify focus moved inside the dialog (not staying on trigger or backdrop)
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Verify backdrop button has tabIndex -1
    const backdrop = screen.getByLabelText("Close dialog");
    expect(backdrop.getAttribute("tabindex")).toBe("-1");

    const escButton = screen.getByRole("button", { name: "Esc" });
    const actionB = screen.getByRole("button", { name: "Action B" });

    // Focus last focusable element and press Tab -> should wrap to first focusable element
    actionB.focus();
    expect(document.activeElement).toBe(actionB);

    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(escButton);

    // Press Shift+Tab on first element -> should wrap to last focusable element
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(actionB);

    // Press Esc to close and verify focus restores to trigger
    fireEvent.click(escButton);
    expect(document.activeElement).toBe(trigger);
  });

  it("restores focus to trigger when closing a ConfirmDialog that has autoFocus on mount (#505)", () => {
    function ConfirmTestComponent() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Open Delete Confirm
          </button>
          <ConfirmDialog
            open={open}
            title="Delete Host"
            description="Are you sure you want to delete this host?"
            cancelLabel="Cancel"
            confirmLabel="Delete"
            defaultFocus="cancel"
            onCancel={() => setOpen(false)}
            onConfirm={() => setOpen(false)}
          />
        </div>
      );
    }

    render(<ConfirmTestComponent />);

    const trigger = screen.getByRole("button", { name: "Open Delete Confirm" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    // Open the confirm dialog
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeDefined();

    // Cancel button received focus via autoFocus in ConfirmDialog
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    // In happy-dom test environment, focus is manually focused if not dispatched by engine
    cancelButton.focus();
    expect(document.activeElement).toBe(cancelButton);

    // Dismiss dialog via Escape key
    fireEvent.keyDown(window, { key: "Escape" });

    // Focus should be restored to the trigger button, NOT fall to body (#505)
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps autoFocus working when a mounted Modal is reopened (#505)", () => {
    function ReopenTestComponent() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Open Rename
          </button>
          <Modal open={open} title="Rename" onClose={() => setOpen(false)}>
            <input aria-label="New name" autoFocus />
          </Modal>
        </div>
      );
    }

    render(<ReopenTestComponent />);
    const trigger = screen.getByRole("button", { name: "Open Rename" });

    // First open: the autoFocus input holds focus; Escape closes and restores the trigger.
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByLabelText("New name"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);

    // Second open: the old trigger must not be refocused over the input's autoFocus, and the
    // focus-in effect must not fall back to the header "Esc" button.
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByLabelText("New name"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps a dark surface in every theme so pale dialog contents stay legible (#UX-2)", () => {
    render(
      <Modal open={true} title="Dark surface" onClose={vi.fn()}>
        <div>Body</div>
      </Modal>
    );
    expect(screen.getByRole("dialog").classList.contains("tw-modal-surface")).toBe(true);
  });
});
