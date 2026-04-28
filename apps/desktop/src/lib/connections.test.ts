import { afterEach, describe, expect, it } from "vitest";
import { buildBackendConnection, buildBackendConnectionFromKnownHost } from "./connections";
import { useConnectionSecretsStore } from "../store/connection-secrets-store";
import { useHostsStore } from "../store/hosts-store";
import { useIdentitiesStore } from "../store/identities-store";
import type { IdentityRecord } from "../types/identity";
import type { KnownHostRecord } from "../types/known-host";

const initialIdentitiesState = useIdentitiesStore.getState();

afterEach(() => {
  useIdentitiesStore.setState(initialIdentitiesState);
});

const trustedKnownHost: KnownHostRecord = {
  id: "127.0.0.1:2222:ssh-ed25519",
  hostname: "127.0.0.1",
  port: 2222,
  algorithm: "ssh-ed25519",
  publicKey: "AAAATESTKEY",
  fingerprint: "SHA256:test",
  trustedAt: "2026-03-29T00:00:00.000Z",
  updatedAt: "2026-03-29T00:00:00.000Z",
};

const baseHost = {
  agentForwarding: true,
  authMethod: "privateKey" as const,
  environment: {
    APP_ENV: "local",
    TERMSNIP_TEST: "enabled",
  },
  hostKeyPolicy: "allowUnknown" as const,
  hostname: "127.0.0.1",
  id: "local-test",
  label: "Local SSH Test",
  port: 2222,
  privateKeyPath: "/tmp/test-key",
  protocol: "ssh" as const,
  sftpRoot: "/tmp",
  username: "deffenda",
};

describe("connection helpers", () => {
  it("allows unknown host keys when the host policy permits it", () => {
    useConnectionSecretsStore.getState().setHostSecrets(baseHost.id, {
      password: "pw",
      passphrase: "phrase",
    });
    const connection = buildBackendConnection(baseHost, []);

    expect(connection.hostname).toBe("127.0.0.1");
    expect(connection.knownHostPublicKey).toBeUndefined();
    expect(connection.password).toBe("pw");
    expect(connection.passphrase).toBe("phrase");
    expect(connection.agentForwarding).toBe(true);
    expect(connection.environment).toEqual(baseHost.environment);
    expect(connection.protocol).toBe("ssh");
  });

  it("requires a trusted host key in strict mode", () => {
    expect(() =>
      buildBackendConnectionFromKnownHost(
        {
          ...baseHost,
          hostKeyPolicy: "requireTrusted",
        },
        undefined
      )
    ).toThrow(/Trusted host key required/);
  });

  it("passes the trusted host key through in strict mode", () => {
    const connection = buildBackendConnectionFromKnownHost(
      {
        ...baseHost,
        hostKeyPolicy: "requireTrusted",
      },
      trustedKnownHost
    );

    expect(connection.knownHostPublicKey).toBe(trustedKnownHost.publicKey);
    expect(connection.knownHostAlgorithm).toBe(trustedKnownHost.algorithm);
  });

  it("builds a one-hop jump host chain", () => {
    useConnectionSecretsStore.getState().setHostSecrets("jump-host", {
      password: "",
      passphrase: "",
    });
    useHostsStore.setState({
      hosts: [
        {
          ...baseHost,
          id: "jump-host",
          label: "Jump Host",
          hostname: "jump.internal",
          group: "Local / Validation",
          tags: ["jump", "validation"],
          note: "Jump host fixture",
          favorite: false,
          keyLabel: "Jump Key",
          jumpHostId: undefined,
          snippetCount: 0,
          forwardingCount: 0,
          createdAt: "2026-03-29T00:00:00.000Z",
          updatedAt: "2026-03-29T00:00:00.000Z",
        },
      ],
    });

    const connection = buildBackendConnection(
      {
        ...baseHost,
        id: "target-host",
        jumpHostId: "jump-host",
      },
      []
    );

    expect(connection.jumpHost?.hostname).toBe("jump.internal");
    expect(connection.jumpHost?.jumpHost).toBeUndefined();
    expect(connection.jumpHost?.agentForwarding).toBe(true);
    expect(connection.jumpHost?.environment).toEqual(baseHost.environment);
  });

  it("builds local shell connections without trust or jump host requirements", () => {
    const connection = buildBackendConnection(
      {
        ...baseHost,
        id: "local-shell",
        label: "Local Shell",
        protocol: "localShell",
        hostname: "localhost",
        username: "local",
        port: 0,
        authMethod: "none",
        privateKeyPath: "",
        jumpHostId: "jump-host",
        sftpRoot: "",
      },
      []
    );

    expect(connection.protocol).toBe("localShell");
    expect(connection.jumpHost).toBeUndefined();
    expect(connection.password).toBe("");
    expect(connection.port).toBe(0);
  });

  it("prefers identity-supplied username, authMethod, and key path when bound (P2-DM1 B3)", () => {
    const identity: IdentityRecord = {
      id: "identity-shared",
      label: "Shared Deploy",
      username: "deploy",
      authMethod: "privateKey",
      privateKeyPath: "~/.ssh/shared-deploy",
      hasPassphrase: false,
      comment: "",
      source: "imported",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    useIdentitiesStore.setState({
      ...initialIdentitiesState,
      identities: [identity],
    });

    const connection = buildBackendConnection(
      {
        ...baseHost,
        // Per-host fields disagree with the identity — identity should win.
        username: "stale-user",
        privateKeyPath: "/tmp/stale-key",
        authMethod: "password",
        identityId: "identity-shared",
      },
      []
    );

    expect(connection.username).toBe("deploy");
    expect(connection.authMethod).toBe("privateKey");
    expect(connection.privateKeyPath).toBe("~/.ssh/shared-deploy");
  });

  it("falls back to per-host fields when no identity is bound (P2-DM1 B3)", () => {
    useIdentitiesStore.setState({
      ...initialIdentitiesState,
      identities: [],
    });

    const connection = buildBackendConnection(
      {
        ...baseHost,
        username: "perhost-user",
        privateKeyPath: "/tmp/perhost-key",
        identityId: undefined,
      },
      []
    );

    expect(connection.username).toBe("perhost-user");
    expect(connection.authMethod).toBe("privateKey");
    expect(connection.privateKeyPath).toBe("/tmp/perhost-key");
  });

  it("falls back to per-host fields when identityId points at a missing identity (P2-DM1 B3)", () => {
    useIdentitiesStore.setState({
      ...initialIdentitiesState,
      identities: [],
    });

    const connection = buildBackendConnection(
      {
        ...baseHost,
        username: "perhost-user",
        privateKeyPath: "/tmp/perhost-key",
        identityId: "missing-identity",
      },
      []
    );

    expect(connection.username).toBe("perhost-user");
    expect(connection.privateKeyPath).toBe("/tmp/perhost-key");
  });

  it("applies trusted host requirements to mosh sessions", () => {
    expect(() =>
      buildBackendConnectionFromKnownHost(
        {
          ...baseHost,
          id: "mosh-host",
          label: "Ops Mosh",
          protocol: "mosh",
          hostKeyPolicy: "requireTrusted",
          sftpRoot: "",
        },
        undefined
      )
    ).toThrow(/Trusted host key required/);

    const connection = buildBackendConnectionFromKnownHost(
      {
        ...baseHost,
        id: "mosh-host",
        label: "Ops Mosh",
        protocol: "mosh",
        hostKeyPolicy: "requireTrusted",
        sftpRoot: "",
      },
      trustedKnownHost
    );

    expect(connection.protocol).toBe("mosh");
    expect(connection.knownHostPublicKey).toBe(trustedKnownHost.publicKey);
  });
});
