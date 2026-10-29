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
import { afterEach, describe, expect, it } from "vitest";
import { HostEditor } from "./HostEditor";

afterEach(cleanup);

function renderEditor() {
  render(<HostEditor open onClose={() => {}} onSave={() => {}} />);
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
