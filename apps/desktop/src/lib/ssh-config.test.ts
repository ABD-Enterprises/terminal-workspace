import { describe, expect, it } from "vitest";
import { parseSshConfig, toHostFormValues } from "./ssh-config";

describe("parseSshConfig", () => {
  it("parses a simple Host block", () => {
    const result = parseSshConfig(`
Host alpha
  HostName alpha.example.com
  User deploy
  Port 2222
  IdentityFile ~/.ssh/alpha_key
`);

    expect(result.hosts).toEqual([
      {
        alias: "alpha",
        hostname: "alpha.example.com",
        username: "deploy",
        port: 2222,
        privateKeyPath: "~/.ssh/alpha_key",
        jumpHostAlias: undefined,
      },
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.defaultsAppliedCount).toBe(0);
    expect(result.unresolvedProxyJumpAliases).toEqual([]);
  });

  it("inherits Host * defaults into concrete hosts and reports them", () => {
    const result = parseSshConfig(`
Host *
  User ops
  IdentityFile ~/.ssh/id_default

Host bastion
  HostName bastion.acme.internal
  Port 2222
`);

    expect(result.hosts).toEqual([
      {
        alias: "bastion",
        hostname: "bastion.acme.internal",
        username: "ops",
        port: 2222,
        privateKeyPath: "~/.ssh/id_default",
        jumpHostAlias: undefined,
      },
    ]);
    expect(result.defaultsAppliedCount).toBe(1);
    expect(result.skipped).toContainEqual({ reason: "wildcard-only", detail: "Host *" });
  });

  it("expands multi-host lines and resolves ProxyJump", () => {
    const result = parseSshConfig(`
Host bastion
  HostName bastion.acme.internal

Host billing-api workers
  HostName billing-api-02.use1.internal
  User deploy
  ProxyJump bastion
  IdentityFile ~/.ssh/deploy_key
`);

    expect(result.hosts.map((host) => host.alias).sort()).toEqual([
      "bastion",
      "billing-api",
      "workers",
    ]);
    const billing = result.hosts.find((host) => host.alias === "billing-api");
    const workers = result.hosts.find((host) => host.alias === "workers");
    expect(billing?.jumpHostAlias).toBe("bastion");
    expect(workers?.jumpHostAlias).toBe("bastion");
    expect(billing?.privateKeyPath).toBe("~/.ssh/deploy_key");
    expect(workers?.privateKeyPath).toBe("~/.ssh/deploy_key");
    expect(result.unresolvedProxyJumpAliases).toEqual([]);
  });

  it("flags ProxyJump targets that do not match any host in the file", () => {
    const result = parseSshConfig(`
Host workers
  HostName workers.internal
  ProxyJump missing-bastion
`);

    expect(result.unresolvedProxyJumpAliases).toEqual(["missing-bastion"]);
  });

  it("records Include blocks as skipped (split out to issue #28)", () => {
    const result = parseSshConfig(`
Include ~/.ssh/work-config
`);

    expect(result.hosts).toEqual([]);
    expect(result.skipped).toContainEqual({
      reason: "include-directive",
      detail: "Include ~/.ssh/work-config",
    });
  });

  it("Match host applies options to aliases matching the pattern", () => {
    const result = parseSshConfig(`
Host alpha
  HostName alpha.example.com

Host beta
  HostName beta.example.com

Match host alpha
  User deploy
  Port 2222
`);

    const alpha = result.hosts.find((host) => host.alias === "alpha");
    const beta = result.hosts.find((host) => host.alias === "beta");
    expect(alpha?.username).toBe("deploy");
    expect(alpha?.port).toBe(2222);
    // beta should not be touched by the Match block.
    expect(beta?.username).toBe("");
    expect(beta?.port).toBe(22);
    // Match is no longer in skipped — it parsed cleanly.
    expect(
      result.skipped.some((entry) => entry.reason === "match-block")
    ).toBe(false);
  });

  it("Match host accepts comma-separated patterns and globs", () => {
    const result = parseSshConfig(`
Host prod-api
  HostName prod-api.example.com

Host prod-worker
  HostName prod-worker.example.com

Host staging-api
  HostName staging-api.example.com

Match host prod-*,*-api
  User ops
`);

    expect(result.hosts.find((host) => host.alias === "prod-api")?.username).toBe("ops");
    expect(result.hosts.find((host) => host.alias === "prod-worker")?.username).toBe("ops");
    // staging-api hits via the `*-api` half of the OR list.
    expect(result.hosts.find((host) => host.alias === "staging-api")?.username).toBe("ops");
  });

  it("Match originalhost behaves the same as Match host for static imports", () => {
    const result = parseSshConfig(`
Host alpha
  HostName alpha.example.com

Match originalhost alpha
  Port 2200
`);

    expect(result.hosts.find((host) => host.alias === "alpha")?.port).toBe(2200);
  });

  it("Match host plus user are AND'd together", () => {
    const result = parseSshConfig(`
Host alpha
  HostName alpha.example.com
  User deploy

Host beta
  HostName beta.example.com
  User deploy

Host gamma
  HostName gamma.example.com
  User ops

Match host alpha,gamma user deploy
  Port 4242
`);

    // alpha matches both host AND user — Port applies.
    expect(result.hosts.find((host) => host.alias === "alpha")?.port).toBe(4242);
    // gamma matches host but not user — no override.
    expect(result.hosts.find((host) => host.alias === "gamma")?.port).toBe(22);
    // beta matches user but not host — no override.
    expect(result.hosts.find((host) => host.alias === "beta")?.port).toBe(22);
  });

  it("Match all applies options to every alias", () => {
    const result = parseSshConfig(`
Host alpha
  HostName alpha.example.com

Host beta
  HostName beta.example.com

Match all
  User ops
`);

    expect(result.hosts.find((host) => host.alias === "alpha")?.username).toBe("ops");
    expect(result.hosts.find((host) => host.alias === "beta")?.username).toBe("ops");
  });

  it("rejects Match all when combined with other criteria", () => {
    const result = parseSshConfig(`
Host alpha
  HostName alpha.example.com

Match all user deploy
  Port 2222
`);

    expect(result.hosts.find((host) => host.alias === "alpha")?.port).toBe(22);
    expect(result.skipped).toContainEqual(
      expect.objectContaining({
        reason: "match-block",
        detail: expect.stringContaining("all:combined"),
      })
    );
  });

  it("Match exec is rejected and its options are dropped", () => {
    const result = parseSshConfig(`
Host alpha
  HostName alpha.example.com

Match exec "true"
  User pwned
`);

    // alpha has no user override.
    expect(result.hosts.find((host) => host.alias === "alpha")?.username).toBe("");
    // Skip reason captures the rejected Match.
    expect(result.skipped).toContainEqual(
      expect.objectContaining({
        reason: "match-block",
        detail: expect.stringContaining("exec"),
      })
    );
  });

  it("Match with unsupported criterion (canonical) is rejected", () => {
    const result = parseSshConfig(`
Host alpha
  HostName alpha.example.com

Match canonical
  User shouldnotapply
`);

    expect(result.hosts.find((host) => host.alias === "alpha")?.username).toBe("");
    expect(result.skipped).toContainEqual(
      expect.objectContaining({
        reason: "match-block",
        detail: expect.stringContaining("canonical"),
      })
    );
  });

  it("Match with negated pattern excludes matching aliases", () => {
    const result = parseSshConfig(`
Host alpha
  HostName alpha.example.com

Host beta
  HostName beta.example.com

Match host *,!alpha
  User ops
`);

    // alpha is excluded by the negation.
    expect(result.hosts.find((host) => host.alias === "alpha")?.username).toBe("");
    // beta matches the * positive pattern with no excluding negation hit.
    expect(result.hosts.find((host) => host.alias === "beta")?.username).toBe("ops");
  });

  it("Match block before its target Host block still applies", () => {
    const result = parseSshConfig(`
Match host alpha
  User deploy

Host alpha
  HostName alpha.example.com
`);

    expect(result.hosts.find((host) => host.alias === "alpha")?.username).toBe("deploy");
  });

  it("Match block before Host block wins when both set the same option", () => {
    const result = parseSshConfig(`
Match host alpha
  User deploy
  Port 2222

Host alpha
  HostName alpha.example.com
  User other
  Port 9999
`);

    const alpha = result.hosts.find((host) => host.alias === "alpha");
    expect(alpha?.username).toBe("deploy");
    expect(alpha?.port).toBe(2222);
  });

  it("Match does not override values already set by an earlier Host block", () => {
    const result = parseSshConfig(`
Host alpha
  HostName alpha.example.com
  User deploy
  Port 2222

Match host alpha
  User other
  Port 9999
`);

    // OpenSSH "first value wins" — Host block options keep precedence.
    const alpha = result.hosts.find((host) => host.alias === "alpha");
    expect(alpha?.username).toBe("deploy");
    expect(alpha?.port).toBe(2222);
  });

  it("ignores comments and inline comments", () => {
    const result = parseSshConfig(`
# top-level comment
Host alpha
  HostName alpha.example.com  # inline note about this host
  User deploy
`);

    expect(result.hosts[0]?.hostname).toBe("alpha.example.com");
  });

  it("falls back to default port 22 when Port is missing or invalid", () => {
    const result = parseSshConfig(`
Host alpha
  HostName alpha.example.com
  Port abc
`);
    expect(result.hosts[0]?.port).toBe(22);
  });

  it("toHostFormValues maps an imported host to editor form values", () => {
    const formValues = toHostFormValues({
      alias: "alpha",
      hostname: "alpha.example.com",
      username: "deploy",
      port: 2222,
      privateKeyPath: "~/.ssh/alpha_key",
      jumpHostAlias: undefined,
    });

    expect(formValues.label).toBe("alpha");
    expect(formValues.hostname).toBe("alpha.example.com");
    expect(formValues.username).toBe("deploy");
    expect(formValues.port).toBe("2222");
    expect(formValues.privateKeyPath).toBe("~/.ssh/alpha_key");
    expect(formValues.authMethod).toBe("privateKey");
  });

  it("toHostFormValues defaults authMethod when no key is provided", () => {
    const formValues = toHostFormValues({
      alias: "alpha",
      hostname: "alpha.example.com",
      username: "",
      port: 22,
      privateKeyPath: "",
      jumpHostAlias: undefined,
    });

    expect(formValues.authMethod).toBe("none");
  });
});
