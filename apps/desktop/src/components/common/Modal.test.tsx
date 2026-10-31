// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
});
