// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
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
});
