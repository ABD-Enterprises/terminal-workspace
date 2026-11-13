// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdentityEditor } from "./IdentityEditor";

describe("IdentityEditor validation", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the submit button enabled so an incomplete form can reveal its errors", () => {
    render(<IdentityEditor open onCancel={vi.fn()} onSubmit={vi.fn()} />);

    const submit = screen.getByRole("button", { name: "Create identity" });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("marks the first missing field, focuses it and refuses to submit", () => {
    const onSubmit = vi.fn();
    render(<IdentityEditor open onCancel={vi.fn()} onSubmit={onSubmit} />);

    expect(screen.queryByText("A label is required.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create identity" }));

    expect(onSubmit).not.toHaveBeenCalled();
    const label = screen.getByLabelText("Identity label");
    expect(label.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("A label is required.")).toBeDefined();
    expect(screen.getByText("A username is required.")).toBeDefined();
    expect(screen.getByText("A private key path is required.")).toBeDefined();
    expect(document.activeElement).toBe(label);
  });

  it("moves focus to the next missing field as earlier ones are filled", () => {
    const onSubmit = vi.fn();
    render(<IdentityEditor open onCancel={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Identity label"), { target: { value: "Deploy" } });
    fireEvent.click(screen.getByRole("button", { name: "Create identity" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByLabelText("Identity username"));
  });

  it("submits once every required field is filled", () => {
    const onSubmit = vi.fn();
    render(<IdentityEditor open onCancel={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Identity label"), { target: { value: "Deploy" } });
    fireEvent.change(screen.getByLabelText("Identity username"), { target: { value: "deploy" } });
    fireEvent.change(screen.getByLabelText("Identity private key path"), {
      target: { value: "~/.ssh/id_example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create identity" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Deploy", username: "deploy" }),
      "imported"
    );
  });
});
