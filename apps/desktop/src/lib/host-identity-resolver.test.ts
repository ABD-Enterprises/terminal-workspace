import { describe, expect, it } from "vitest";
import type { HostRecord } from "../types/host";
import type { IdentityRecord } from "../types/identity";
import {
  resolveHostIdentityFrom,
  resolveIdentityForHost,
} from "./host-identity-resolver";

function makeIdentity(overrides: Partial<IdentityRecord>): IdentityRecord {
  return {
    id: "identity-x",
    label: "Identity X",
    username: "alice",
    authMethod: "privateKey",
    privateKeyPath: "~/.ssh/id_x",
    hasPassphrase: false,
    comment: "",
    source: "imported",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveHostIdentityFrom", () => {
  it("returns the identity for a host that references it", () => {
    const hosts = [{ id: "h1", identityId: "identity-x" }];
    const identities = [makeIdentity({})];
    expect(resolveHostIdentityFrom("h1", hosts, identities)?.id).toBe("identity-x");
  });

  it("returns undefined when the host has no identityId", () => {
    const hosts = [{ id: "h1", identityId: undefined }];
    const identities = [makeIdentity({})];
    expect(resolveHostIdentityFrom("h1", hosts, identities)).toBeUndefined();
  });

  it("returns undefined when the host's identityId points at a missing record", () => {
    const hosts = [{ id: "h1", identityId: "deleted" }];
    const identities = [makeIdentity({ id: "identity-x" })];
    expect(resolveHostIdentityFrom("h1", hosts, identities)).toBeUndefined();
  });

  it("returns undefined for a host id that does not exist", () => {
    const hosts = [{ id: "h1", identityId: "identity-x" }];
    const identities = [makeIdentity({})];
    expect(resolveHostIdentityFrom("missing", hosts, identities)).toBeUndefined();
  });

  it("two hosts referencing the same identity resolve to it (sharing)", () => {
    const hosts = [
      { id: "h1", identityId: "identity-x" },
      { id: "h2", identityId: "identity-x" },
    ];
    const identities = [makeIdentity({})];
    expect(resolveHostIdentityFrom("h1", hosts, identities)?.id).toBe("identity-x");
    expect(resolveHostIdentityFrom("h2", hosts, identities)?.id).toBe("identity-x");
  });
});

describe("resolveIdentityForHost", () => {
  it("returns the identity when the host carries a matching identityId", () => {
    const host: Pick<HostRecord, "identityId"> = { identityId: "identity-x" };
    const identities = [makeIdentity({})];
    expect(resolveIdentityForHost(host, identities)?.id).toBe("identity-x");
  });

  it("returns undefined when identityId is empty", () => {
    const host: Pick<HostRecord, "identityId"> = { identityId: "" };
    const identities = [makeIdentity({})];
    expect(resolveIdentityForHost(host, identities)).toBeUndefined();
  });

  it("returns undefined when the identityId does not match any record", () => {
    const host: Pick<HostRecord, "identityId"> = { identityId: "missing" };
    const identities = [makeIdentity({ id: "identity-x" })];
    expect(resolveIdentityForHost(host, identities)).toBeUndefined();
  });
});
