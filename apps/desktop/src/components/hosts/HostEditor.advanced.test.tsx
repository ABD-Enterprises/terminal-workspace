// @vitest-environment happy-dom
//
// Collapsed-disclosure contract (#464). Trust, jump-host and favorite state
// all render behind "Show advanced settings", so an editor collapsed by
// default hid them entirely — a user could edit and save without ever
// seeing that a host requires a trusted key or routes through a bastion.
// The toggle now carries a count while collapsed so that state stays
// legible without expanding.
//
// Named HostEditor.advanced.test rather than HostEditor.test so it does not
// collide with the sibling HostEditor.test.ts: TypeScript deduplicates
// same-basename inputs differing only by extension, and the collision kept
// this file out of the type-check program.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { HostRecord } from "../../types/host";
import { HostEditor } from "./HostEditor";

function makeHost(overrides: Partial<HostRecord>): HostRecord {
  return {
    id: "host-1",
    label: "Example",
    protocol: "ssh",
    hostname: "example.internal",
    username: "operator",
    port: 22,
    authMethod: "password",
    privateKeyPath: "",
    group: "",
    tags: [],
    note: "",
    favorite: false,
    keyLabel: "",
    hostKeyPolicy: "allowUnknown",
    agentForwarding: false,
    environment: {},
    jumpHostId: "",
    sftpRoot: "",
    snippetCount: 0,
    forwardingCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(cleanup);

describe("HostEditor advanced disclosure", () => {
  // Exact-string name match: a regex like /Show advanced settings/ also
  // matches "... — 1 set", which would let this pass if the count rendered
  // unconditionally.
  it("shows no count when trust is relaxed and no other advanced value is set", () => {
    render(<HostEditor open host={makeHost({})} onClose={() => {}} onSave={() => {}} />);
    expect(screen.getByRole("button", { name: "Show advanced settings" })).toBeTruthy();
    expect(screen.queryByText(/\d+ set/)).toBeNull();
  });

  it("counts the default trust requirement on a host that has not been edited", () => {
    // defaultHostKeyPolicy is "requireTrusted", so a fresh Add Host form
    // reports 1 set before any edit. Intended: the trust requirement is
    // real state the collapsed disclosure hides, however it got there.
    render(<HostEditor open host={makeHost({ hostKeyPolicy: "requireTrusted" })} onClose={() => {}} onSave={() => {}} />);
    expect(screen.getByRole("button", { name: "Show advanced settings — 1 set" })).toBeTruthy();
  });

  it("counts the default trust requirement on a fresh Add Host form with no host bound", () => {
    // No `host` prop is the create path (HostsPage passes undefined when
    // editingHost is null). emptyHostFormValues carries the default trust
    // policy, so the collapsed disclosure must report it here too.
    render(<HostEditor open onClose={() => {}} onSave={() => {}} />);
    expect(screen.getByRole("button", { name: "Show advanced settings — 1 set" })).toBeTruthy();
  });

  it("counts a favorite pin while collapsed", () => {
    render(
      <HostEditor open host={makeHost({ favorite: true })} onClose={() => {}} onSave={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Show advanced settings — 1 set" })).toBeTruthy();
  });

  it("counts a jump host while collapsed", () => {
    render(
      <HostEditor
        open
        host={makeHost({ jumpHostId: "host-bastion" })}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Show advanced settings — 1 set" })).toBeTruthy();
  });

  it("counts multiple set values", () => {
    render(
      <HostEditor
        open
        host={makeHost({ favorite: true, hostKeyPolicy: "requireTrusted" })}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Show advanced settings — 2 set" })).toBeTruthy();
  });

  it("expands to the plain Hide label once opened", () => {
    render(
      <HostEditor open host={makeHost({ favorite: true })} onClose={() => {}} onSave={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Show advanced settings/ }));
    const toggle = screen.getByRole("button", { name: "Hide advanced settings" });
    expect(toggle.textContent).not.toMatch(/\d+ set/);
  });
});
