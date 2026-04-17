import { afterEach, describe, expect, it } from "vitest";
import { defaultHostKeyPolicy, defaultHostProtocol, emptyHostFormValues, sampleHosts } from "../types/host";
import {
  applyHostFilters,
  buildHostEnvironmentSections,
  createHostRecord,
  deleteHostFromCollection,
  sampleEnvironments,
  sortHostCollection,
  toggleHostFavoriteInCollection,
  upsertHostCollection,
  useHostsStore,
} from "./hosts-store";

const baseHostsState = useHostsStore.getState();

afterEach(() => {
  useHostsStore.setState(baseHostsState);
});

describe("hosts store helpers", () => {
  it("creates and updates host records", () => {
    const draft = {
      ...emptyHostFormValues,
      label: "Docs Box",
      hostname: "docs.internal",
      username: "writer",
      agentForwarding: true,
      environment: "APP_ENV=staging\nFEATURE_FLAG=true",
      tags: "docs, favorite, staging",
      group: "Acme / Docs",
    };

    const created = createHostRecord(draft);
    expect(created.label).toBe("Docs Box");
    expect(created.protocol).toBe("ssh");
    expect(created.tags).toEqual(["docs", "staging"]);
    expect(created.hostKeyPolicy).toBe(defaultHostKeyPolicy);
    expect(created.agentForwarding).toBe(true);
    expect(created.environment).toEqual({
      APP_ENV: "staging",
      FEATURE_FLAG: "true",
    });

    const updatedHosts = upsertHostCollection(sampleHosts, draft, sampleHosts[1].id);
    expect(updatedHosts.find((host) => host.id === sampleHosts[1].id)?.label).toBe("Docs Box");
  });

  it("filters hosts by query, favorites, groups, and tags", () => {
    const results = applyHostFilters(sampleHosts, {
      query: "router",
      activeEnvironmentId: "env-east-region",
      activeTag: "router",
      favoritesOnly: false,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.label).toBe("Edge Router 07");

    const favoriteOnly = applyHostFilters(sampleHosts, {
      query: "",
      activeEnvironmentId: "all",
      activeTag: "all",
      favoritesOnly: true,
    });

    expect(favoriteOnly).toHaveLength(1);
    expect(favoriteOnly[0]?.favorite).toBe(true);
  });

  it("toggles favorites and deletes hosts", () => {
    const toggled = toggleHostFavoriteInCollection(sampleHosts, sampleHosts[1].id);
    expect(toggled.find((host) => host.id === sampleHosts[1].id)?.favorite).toBe(true);

    const deleted = deleteHostFromCollection(sampleHosts, sampleHosts[0].id);
    expect(deleted).toHaveLength(sampleHosts.length - 1);
    expect(deleted.some((host) => host.id === sampleHosts[0].id)).toBe(false);
  });

  it("normalizes older hosts without an explicit host key policy", () => {
    const normalized = sortHostCollection([
      {
        ...sampleHosts[0],
        tags: [...sampleHosts[0].tags, "favorite"],
        password: "secret",
        passphrase: "secret",
        agentForwarding: undefined,
        environment: undefined,
        hostKeyPolicy: undefined,
      } as unknown as (typeof sampleHosts)[number],
    ]);

    expect(normalized[0]?.hostKeyPolicy).toBe(defaultHostKeyPolicy);
    expect(normalized[0]?.protocol).toBe(defaultHostProtocol);
    expect(normalized[0]?.agentForwarding).toBe(false);
    expect(normalized[0]?.environment).toEqual({});
    expect(normalized[0]?.tags).not.toContain("favorite");
    expect("password" in (normalized[0] ?? {})).toBe(false);
    expect("passphrase" in (normalized[0] ?? {})).toBe(false);
  });

  it("normalizes local shell entries without ssh-only fields", () => {
    const created = createHostRecord({
      ...emptyHostFormValues,
      label: "Native Shell",
      protocol: "localShell",
      username: "",
      hostname: "",
      port: "",
      authMethod: "privateKey",
      privateKeyPath: "~/.ssh/id_local",
      keyLabel: "Should Clear",
      jumpHostId: sampleHosts[0].id,
      sftpRoot: "/srv",
    });

    expect(created.hostname).toBe("localhost");
    expect(created.port).toBe(0);
    expect(created.authMethod).toBe("none");
    expect(created.privateKeyPath).toBe("");
    expect(created.keyLabel).toBe("");
    expect(created.jumpHostId).toBeUndefined();
    expect(created.sftpRoot).toBe("");
  });

  it("uses protocol defaults for telnet and serial inventory", () => {
    const telnetHost = createHostRecord({
      ...emptyHostFormValues,
      label: "Legacy BBS",
      protocol: "telnet",
      hostname: "bbs.internal",
      username: "ignored",
      port: "",
      authMethod: "password",
    });
    const serialHost = createHostRecord({
      ...emptyHostFormValues,
      label: "Console Cable",
      protocol: "serial",
      hostname: "/dev/cu.usbserial-1410",
      username: "ignored",
      port: "",
      authMethod: "privateKey",
    });

    expect(telnetHost.port).toBe(23);
    expect(telnetHost.username).toBe("");
    expect(telnetHost.authMethod).toBe("none");
    expect(serialHost.port).toBe(115200);
    expect(serialHost.username).toBe("");
    expect(serialHost.authMethod).toBe("none");
  });

  it("keeps mosh credential metadata when the host uses ssh-style auth", () => {
    const created = createHostRecord({
      ...emptyHostFormValues,
      label: "Ops Mosh",
      protocol: "mosh",
      hostname: "ops.internal",
      username: "ops",
      port: "",
      authMethod: "privateKey",
      privateKeyPath: "~/.ssh/id_ops",
      keyLabel: "Ops Key",
      hostKeyPolicy: "requireTrusted",
    });

    expect(created.port).toBe(22);
    expect(created.authMethod).toBe("privateKey");
    expect(created.privateKeyPath).toBe("~/.ssh/id_ops");
    expect(created.keyLabel).toBe("Ops Key");
    expect(created.hostKeyPolicy).toBe("requireTrusted");
  });

  it("builds grouped environment sections for nested host inventory", () => {
    const sections = buildHostEnvironmentSections(sampleHosts, sampleEnvironments);

    expect(sections[0]?.environment?.label).toBe("Acme Production Account");
    expect(sections[0]?.hosts[0]?.id).toBe("prod-gateway");
    expect(sections.some((section) => section.environment?.label === "Local Workstation")).toBe(
      true
    );
  });

  it("imports ssh config hosts into a named environment", () => {
    const baseState = useHostsStore.getState();
    const createdEnvironmentId = baseState.createEnvironment({
      label: "Imported Config",
      kind: "custom",
      description: "Bootstrap imports",
    });

    const result = useHostsStore
      .getState()
      .importHostsFromSshConfig(
        "Host prod-gateway\n  HostName bastion.acme.internal\n  User ops\n  IdentityFile ~/.ssh/id_ed25519\n",
        createdEnvironmentId
      );

    const importedHost = useHostsStore
      .getState()
      .hosts.find((host) => host.id === "ssh-config-prod-gateway");

    expect(result.importedCount).toBe(1);
    expect(result.environmentId).toBe(createdEnvironmentId);
    expect(importedHost).toMatchObject({
      environmentId: createdEnvironmentId,
      hostname: "bastion.acme.internal",
      username: "ops",
      privateKeyPath: "~/.ssh/id_ed25519",
    });
  });
});
