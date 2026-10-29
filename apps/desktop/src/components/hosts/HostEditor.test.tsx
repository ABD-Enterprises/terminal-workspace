// @vitest-environment happy-dom
//
// Collapsed-disclosure contract (#464). Trust, jump-host and favorite state
// all render behind "Show advanced settings", so an editor collapsed by
// default hid them entirely — a user could edit and save without ever
// seeing that a host requires a trusted key or routes through a bastion.
// The toggle now carries a count while collapsed so that state stays
// legible without expanding.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { HostRecord } from "../../../types/host";
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
  } as HostRecord;
}

afterEach(cleanup);

describe("HostEditor advanced disclosure", () => {
  it("shows no count when nothing advanced is set", () => {
    render(<HostEditor open host={makeHost({})} onClose={() => {}} onSave={() => {}} />);
    expect(screen.getByRole("button", { name: /Show advanced settings/ })).toBeTruthy();
  });

  it("counts a trusted-key requirement while collapsed", () => {
    render(
      <HostEditor
        open
        host={makeHost({ hostKeyPolicy: "requireTrusted" })}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Show advanced settings — 1 set/ })).toBeTruthy();
  });

  it("counts a favorite pin while collapsed", () => {
    render(
      <HostEditor open host={makeHost({ favorite: true })} onClose={() => {}} onSave={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /Show advanced settings — 1 set/ })).toBeTruthy();
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
    expect(screen.getByRole("button", { name: /Show advanced settings — 2 set/ })).toBeTruthy();
  });

  it("expands to the plain Hide label once opened", () => {
    render(
      <HostEditor open host={makeHost({ favorite: true })} onClose={() => {}} onSave={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Show advanced settings/ }));
    const toggle = screen.getByRole("button", { name: /Hide advanced settings/ });
    expect(toggle.textContent).not.toMatch(/\d+ set/);
  });
});
