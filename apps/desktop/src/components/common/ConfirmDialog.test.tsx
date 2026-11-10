// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("imports successfully", async () => {
    const mod = await import("./ConfirmDialog");
    expect(mod).toBeDefined();
  });

  it("renders the description once via the Modal subtitle without duplicating it in the body (#511)", () => {
    const warningText = "This removes the host and wipes saved credentials.";
    render(
      <ConfirmDialog
        open={true}
        title="Delete host"
        description={warningText}
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const matches = screen.getAllByText(warningText);
    expect(matches).toHaveLength(1);
  });

  it("places autoFocus on the Cancel button by default to prevent accidental deletion (#512)", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Delete host"
        description="Irreversible action."
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const cancelButton = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    const confirmButton = screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement;
    expect(cancelButton.autofocus || cancelButton.hasAttribute("autofocus") || document.activeElement === cancelButton).toBe(true);
    expect(confirmButton.autofocus || confirmButton.hasAttribute("autofocus")).toBe(false);
  });

  it("does not trigger onConfirm when Enter is pressed with default cancel focus (#512)", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Delete host"
        description="Irreversible action."
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("places autoFocus on the confirm button when defaultFocus is set to confirm", () => {
    render(
      <ConfirmDialog
        open={true}
        title="Proceed"
        description="Non-destructive action."
        confirmLabel="Proceed"
        defaultFocus="confirm"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const cancelButton = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    const confirmButton = screen.getByRole("button", { name: "Proceed" }) as HTMLButtonElement;
    expect(cancelButton.autofocus || cancelButton.hasAttribute("autofocus")).toBe(false);
    expect(confirmButton.autofocus || confirmButton.hasAttribute("autofocus") || document.activeElement === confirmButton).toBe(true);
  });

  it("triggers onConfirm on Enter when defaultFocus is explicitly set to confirm", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Proceed"
        description="Non-destructive action."
        confirmLabel="Proceed"
        defaultFocus="confirm"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
