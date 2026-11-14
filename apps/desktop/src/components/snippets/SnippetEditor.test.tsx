// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SnippetEditor } from "./SnippetEditor";

describe("SnippetEditor validation", () => {
  afterEach(() => {
    cleanup();
  });

  it("marks the missing title and refuses to save on submit", () => {
    const onSave = vi.fn();
    render(
      <SnippetEditor open hosts={[]} onClose={vi.fn()} onSave={onSave} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Create snippet" }));

    expect(onSave).not.toHaveBeenCalled();
    const titleInput = screen.getByPlaceholderText("Restart billing workers");
    expect(titleInput.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("A title is required.")).toBeDefined();
    expect(document.activeElement).toBe(titleInput);
  });

  it("moves to the command field once the title is filled", () => {
    const onSave = vi.fn();
    render(
      <SnippetEditor open hosts={[]} onClose={vi.fn()} onSave={onSave} />
    );

    fireEvent.change(screen.getByPlaceholderText("Restart billing workers"), {
      target: { value: "Nightly restart" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create snippet" }));

    expect(onSave).not.toHaveBeenCalled();
    const commandInput = screen.getByPlaceholderText("uname -a && uptime");
    expect(commandInput.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("A command is required.")).toBeDefined();
    expect(document.activeElement).toBe(commandInput);
  });

  it("saves once both required fields are filled", () => {
    const onSave = vi.fn();
    render(
      <SnippetEditor open hosts={[]} onClose={vi.fn()} onSave={onSave} />
    );

    fireEvent.change(screen.getByPlaceholderText("Restart billing workers"), {
      target: { value: "Nightly restart" },
    });
    fireEvent.change(screen.getByPlaceholderText("uname -a && uptime"), {
      target: { value: "systemctl restart workers" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create snippet" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Nightly restart", command: "systemctl restart workers" })
    );
  });
});
