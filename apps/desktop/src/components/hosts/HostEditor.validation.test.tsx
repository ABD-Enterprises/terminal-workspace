// @vitest-environment happy-dom
//
// Form validation in the host editor.
//
// The submit button used to be disabled with no explanation anywhere. A user
// who left a required field blank saw a greyed-out "Create host" button and
// no indication of what was missing or which field was at fault. Each field
// now carries its own message, marked with aria-invalid, and the footer
// states how many fields still need attention.
//
// Named HostEditor.validation.test so it does not collide with the sibling
// HostEditor.test.ts (TypeScript deduplicates same-basename inputs differing
// only by extension).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostEditor } from "./HostEditor";

afterEach(cleanup);

function renderEditor(onSave = vi.fn()) {
  render(<HostEditor open onClose={() => {}} onSave={onSave} />);
  return onSave;
}

function inputFor(labelText: string): HTMLInputElement {
  const label = screen.getByText(labelText).closest("label");
  const input = label?.querySelector("input");
  if (!input) {
    throw new Error(`no input found for ${labelText}`);
  }
  return input;
}

describe("HostEditor form validation", () => {
  it("names every missing required field on a fresh form", () => {
    renderEditor();

    // A fresh SSH host has no label, hostname, or username.
    expect(screen.getByText("A label is required.")).toBeTruthy();
    expect(screen.getByText("A hostname is required.")).toBeTruthy();
    expect(screen.getByText("A username is required.")).toBeTruthy();
    expect(screen.getByText("3 fields still need attention.")).toBeTruthy();
  });

  it("marks an invalid field for assistive tech", () => {
    renderEditor();

    expect(inputFor("Label").getAttribute("aria-invalid")).toBe("true");
    expect(inputFor("Hostname").getAttribute("aria-invalid")).toBe("true");
    expect(inputFor("Username").getAttribute("aria-invalid")).toBe("true");
  });

  it("points each field's description at that field's own message", () => {
    renderEditor();

    const fields = [
      ["Label", "A label is required."],
      ["Hostname", "A hostname is required."],
      ["Username", "A username is required."],
    ] as const;

    for (const [labelText, message] of fields) {
      const describedBy = inputFor(labelText).getAttribute("aria-describedby");
      expect(describedBy, `${labelText} must describe itself`).toBeTruthy();

      const target = document.getElementById(describedBy as string);
      expect(target, `${labelText} description target must exist`).not.toBeNull();
      expect(target?.textContent, `${labelText} description target`).toBe(message);
    }
  });

  it("keeps submit disabled while a required field is missing", () => {
    renderEditor();

    const submit = screen.getByRole("button", { name: "Create host" });
    expect(submit.hasAttribute("disabled")).toBe(true);

    fireEvent.change(inputFor("Label"), { target: { value: "Production Gateway" } });
    fireEvent.change(inputFor("Hostname"), { target: { value: "gateway.internal" } });
    fireEvent.change(inputFor("Username"), { target: { value: "operator" } });

    expect(submit.hasAttribute("disabled")).toBe(false);
  });

  it("clears a field's error once it is filled in", () => {
    renderEditor();

    fireEvent.change(inputFor("Label"), { target: { value: "Production Gateway" } });

    expect(screen.queryByText("A label is required.")).toBeNull();
    expect(inputFor("Label").getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByText("2 fields still need attention.")).toBeTruthy();
  });

  it("rejects a port that is not a number", () => {
    renderEditor();

    fireEvent.change(inputFor("Port"), { target: { value: "not-a-port" } });

    expect(screen.getByText("Enter a number.")).toBeTruthy();
    expect(inputFor("Port").getAttribute("aria-invalid")).toBe("true");
  });

  it("rejects a port outside the valid range", () => {
    renderEditor();

    fireEvent.change(inputFor("Port"), { target: { value: "70000" } });

    expect(screen.getByText("Enter a port between 1 and 65535.")).toBeTruthy();
  });

  it("keeps submit disabled while the port is not a number", () => {
    // The message alone is not enough: if the port error were not part of
    // what blocks the save, a typo'd port would surface later as an invisible
    // connect failure — the whole reason the field is validated here.
    renderEditor();

    fireEvent.change(inputFor("Label"), { target: { value: "Production Gateway" } });
    fireEvent.change(inputFor("Hostname"), { target: { value: "gateway.internal" } });
    fireEvent.change(inputFor("Username"), { target: { value: "operator" } });

    const submit = screen.getByRole("button", { name: "Create host" });
    expect(submit.hasAttribute("disabled")).toBe(false);

    fireEvent.change(inputFor("Port"), { target: { value: "not-a-port" } });
    expect(submit.hasAttribute("disabled")).toBe(true);

    fireEvent.change(inputFor("Port"), { target: { value: "22" } });
    expect(submit.hasAttribute("disabled")).toBe(false);
  });

  it("requires a port before the host can be saved", () => {
    renderEditor();

    fireEvent.change(inputFor("Label"), { target: { value: "Production Gateway" } });
    fireEvent.change(inputFor("Hostname"), { target: { value: "gateway.internal" } });
    fireEvent.change(inputFor("Username"), { target: { value: "operator" } });

    // The field starts at the protocol's default port, so it has to be
    // cleared to be empty.
    fireEvent.change(inputFor("Port"), { target: { value: "" } });

    expect(screen.getByText("A port is required.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create host" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("does not save a host whose port is invalid", () => {
    // The disabled button is the first line of defence; the submit handler's
    // own guard is the second, and it is the one a keyboard or a scripted
    // submit reaches.
    const onSave = renderEditor();

    fireEvent.change(inputFor("Label"), { target: { value: "Production Gateway" } });
    fireEvent.change(inputFor("Hostname"), { target: { value: "gateway.internal" } });
    fireEvent.change(inputFor("Username"), { target: { value: "operator" } });
    fireEvent.change(inputFor("Port"), { target: { value: "not-a-port" } });

    const form = document.querySelector("form");
    if (!form) {
      throw new Error("host editor form not found");
    }
    fireEvent.submit(form);

    expect(onSave).not.toHaveBeenCalled();
  });

  it("announces a field error as an alert", () => {
    // The aria-describedby linkage carries the message to a screen-reader
    // user who navigates to the field. The alert role is what announces it
    // when the error appears while focus is elsewhere.
    renderEditor();

    expect(screen.getByText("A label is required.").getAttribute("role")).toBe("alert");
    expect(screen.getByText("A hostname is required.").getAttribute("role")).toBe("alert");
    expect(screen.getByText("A username is required.").getAttribute("role")).toBe("alert");

    fireEvent.change(inputFor("Port"), { target: { value: "not-a-port" } });
    expect(screen.getByText("Enter a number.").getAttribute("role")).toBe("alert");
  });

  it("accepts a serial baud rate that is above the TCP port range", () => {
    renderEditor();

    const protocol = screen.getByText("Protocol").closest("label")?.querySelector("select");
    if (!protocol) {
      throw new Error("protocol select not found");
    }
    fireEvent.change(protocol, { target: { value: "serial" } });

    // Serial uses the port field as a baud rate; 115200 is its default and
    // must not be rejected by the 1-65535 TCP port range.
    expect(inputFor("Baud rate").getAttribute("value")).toBe("115200");
    expect(screen.queryByText("Enter a port between 1 and 65535.")).toBeNull();
    expect(screen.getByText("A device path is required.")).toBeTruthy();
  });

  it("does not ask for a hostname or username on a local shell", () => {
    renderEditor();

    const protocol = screen.getByText("Protocol").closest("label")?.querySelector("select");
    if (!protocol) {
      throw new Error("protocol select not found");
    }
    fireEvent.change(protocol, { target: { value: "localShell" } });

    expect(screen.queryByText("A hostname is required.")).toBeNull();
    expect(screen.queryByText("A username is required.")).toBeNull();
    expect(screen.getByText("A label is required.")).toBeTruthy();
  });
});
