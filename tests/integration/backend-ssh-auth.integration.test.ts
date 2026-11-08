import { describe, expect, it } from "vitest";

import {
  SshAuthRefusedError,
  sshAuthOptions,
} from "../../apps/desktop/server/backend-ssh-auth.mjs";

// #473: the sign-in rules every backend SSH connection is built from.

const AGENT = "/tmp/agent.sock";

function host(overrides: Record<string, unknown> = {}) {
  return { hostname: "target.internal", authMethod: "password", agentForwarding: false, ...overrides };
}

describe("sshAuthOptions (#473)", () => {
  it.each([["agent"], ["none"], ["keyboard-interactive"], [""], [undefined], [42]])(
    "refuses sign-in method %s with a 400",
    (authMethod) => {
      let caught: unknown;
      try {
        sshAuthOptions(host({ authMethod }), { authorizedBy: "token" });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(SshAuthRefusedError);
      expect((caught as SshAuthRefusedError).statusCode).toBe(400);
    }
  );

  it("tries only the host's own sign-in method, never the agent", () => {
    expect(sshAuthOptions(host(), { agentSocket: AGENT }).authHandler).toEqual(["password"]);
    expect(
      sshAuthOptions(host({ authMethod: "privateKey" }), { agentSocket: AGENT }).authHandler
    ).toEqual(["publickey"]);
  });

  it("forwards the agent only for a request that presented the token", () => {
    const options = sshAuthOptions(host({ agentForwarding: true }), {
      authorizedBy: "token",
      agentSocket: AGENT,
    });
    expect(options).toMatchObject({ agent: AGENT, agentForward: true, authHandler: ["password"] });
  });

  it.each([["origin"], [undefined]])(
    "refuses agent forwarding with a 403 for a request authorized by %s",
    (authorizedBy) => {
      let caught: unknown;
      try {
        sshAuthOptions(host({ agentForwarding: true }), { authorizedBy, agentSocket: AGENT });
      } catch (error) {
        caught = error;
      }
      expect((caught as SshAuthRefusedError).statusCode).toBe(403);
    }
  );

  it("sets no agent when forwarding is off", () => {
    const options = sshAuthOptions(host(), { authorizedBy: "token", agentSocket: AGENT });
    expect(options).not.toHaveProperty("agent");
    expect(options).not.toHaveProperty("agentForward");
  });
});
