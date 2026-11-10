import { describe, expect, it } from "vitest";

// SEC-1 / SEC-4: the host record reaches the Node backend in the request
// body, so the parts the backend must not take on trust are checked before
// anything is done with it. The module lives outside backend.mjs precisely so
// these rules can be asserted without binding a port.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let validation: any;
async function load() {
  if (!validation) {
    validation = await import("../../apps/desktop/server/backend-host-validation.mjs");
  }
  return validation;
}

function host(overrides: Record<string, unknown> = {}) {
  return {
    hostname: "example.internal",
    port: 22,
    username: "ops",
    authMethod: "privateKey",
    privateKeyPath: "~/.ssh/id_ed25519",
    agentForwarding: false,
    ...overrides,
  };
}

describe("backend host validation", () => {
  describe("authMethod allowlist", () => {
    it("accepts the three methods the host type defines", async () => {
      const { isSupportedAuthMethod } = await load();

      expect(isSupportedAuthMethod("none")).toBe(true);
      expect(isSupportedAuthMethod("password")).toBe(true);
      expect(isSupportedAuthMethod("privateKey")).toBe(true);
    });

    it("rejects an unrecognised method, including agent", async () => {
      const { isSupportedAuthMethod } = await load();

      expect(isSupportedAuthMethod("agent")).toBe(false);
      expect(isSupportedAuthMethod("keyboard-interactive")).toBe(false);
      expect(isSupportedAuthMethod("")).toBe(false);
    });

    it("keeps a missing method behaving as it did before", async () => {
      // A host record saved before the field existed must not start failing.
      const { isSupportedAuthMethod } = await load();

      expect(isSupportedAuthMethod(undefined)).toBe(true);
    });

    it("refuses the request with a 400 and never echoes the rejected value", async () => {
      const { assertHostRequestIsAllowed } = await load();

      let thrown: unknown;
      try {
        assertHostRequestIsAllowed(host({ authMethod: "agent" }));
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as { statusCode?: number }).statusCode).toBe(400);
      expect((thrown as Error).message).toBe("Unsupported authentication method.");
      expect((thrown as Error).message).not.toContain("agent");
    });
  });

  describe("agent forwarding", () => {
    it("is off unless the operator turned it on", async () => {
      const { agentForwardingAllowed } = await load();

      expect(agentForwardingAllowed({})).toBe(false);
      expect(agentForwardingAllowed({ TERMSNIP_ALLOW_AGENT_FORWARDING: "0" })).toBe(false);
      expect(agentForwardingAllowed({ TERMSNIP_ALLOW_AGENT_FORWARDING: "true" })).toBe(false);
      expect(agentForwardingAllowed({ TERMSNIP_ALLOW_AGENT_FORWARDING: "1" })).toBe(true);
    });

    it("refuses a request that asks for it while it is off", async () => {
      const { assertHostRequestIsAllowed } = await load();

      let thrown: unknown;
      try {
        assertHostRequestIsAllowed(host({ agentForwarding: true }), {});
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as { statusCode?: number }).statusCode).toBe(403);
      expect((thrown as Error).message).toBe("Agent forwarding is disabled on this backend.");
    });

    it("allows the request once the operator turned it on", async () => {
      const { assertHostRequestIsAllowed } = await load();

      expect(() =>
        assertHostRequestIsAllowed(host({ agentForwarding: true }), {
          TERMSNIP_ALLOW_AGENT_FORWARDING: "1",
        })
      ).not.toThrow();
    });

    it("does not object to a host that does not ask for agent forwarding", async () => {
      const { assertHostRequestIsAllowed } = await load();

      expect(() => assertHostRequestIsAllowed(host(), {})).not.toThrow();
    });
  });

  it("passes a well-formed host record", async () => {
    const { assertHostRequestIsAllowed } = await load();

    expect(() => assertHostRequestIsAllowed(host(), {})).not.toThrow();
  });
});
