// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
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
});
