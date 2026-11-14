// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyEditor } from "./KeyEditor";

describe("KeyEditor", () => {
  afterEach(() => {
    cleanup();
  });

  it("imports successfully", async () => {
    const mod = await import("./KeyEditor");
    expect(mod).toBeDefined();
  });

  it("renders error message with role='alert' when errorMessage is provided", () => {
    render(
      <KeyEditor
        open={true}
        mode="import"
        errorMessage="Invalid private key format"
        onClose={vi.fn()}
        onImport={vi.fn()}
        onGenerate={vi.fn()}
      />
    );

    const alert = screen.getByRole("alert");
    expect(alert).toBeDefined();
    expect(alert.textContent).toContain("Invalid private key format");
  });

  it("does not render role='alert' when errorMessage is absent", () => {
    render(
      <KeyEditor
        open={true}
        mode="import"
        onClose={vi.fn()}
        onImport={vi.fn()}
        onGenerate={vi.fn()}
      />
    );

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refuses to import with a blank label and focuses the label field", () => {
    const onImport = vi.fn();
    render(
      <KeyEditor
        open={true}
        mode="import"
        onClose={vi.fn()}
        onImport={onImport}
        onGenerate={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Import key" }));

    expect(onImport).not.toHaveBeenCalled();
    const labelInput = screen.getByPlaceholderText("MacBook Pro ED25519");
    expect(labelInput.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("A label is required.")).toBeDefined();
    expect(document.activeElement).toBe(labelInput);
  });

  it("requires a label for key generation too", () => {
    const onGenerate = vi.fn();
    render(
      <KeyEditor
        open={true}
        mode="generate"
        onClose={vi.fn()}
        onImport={vi.fn()}
        onGenerate={onGenerate}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate key" }));

    expect(onGenerate).not.toHaveBeenCalled();
    const labelInput = screen.getByPlaceholderText("Generated Ops Key");
    expect(labelInput.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(labelInput);

    fireEvent.change(labelInput, { target: { value: "Ops key" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate key" }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });
});
