import { describe, expect, it } from "vitest";
import { buildBackendConnection, buildBackendConnectionFromKnownHost } from "./connections";
import { useConnectionSecretsStore } from "../store/connection-secrets-store";
import { useHostsStore } from "../store/hosts-store";
import type { KnownHostRecord } from "../types/known-host";

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
});
