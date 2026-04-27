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

  it("records Match and Include blocks as skipped", () => {
    const result = parseSshConfig(`
Match host *.private
  ForwardAgent yes

Include ~/.ssh/work-config
`);

    expect(result.hosts).toEqual([]);
    expect(result.skipped).toContainEqual({
      reason: "match-block",
      detail: "Match host *.private",
    });
    expect(result.skipped).toContainEqual({
      reason: "include-directive",
      detail: "Include ~/.ssh/work-config",
    });
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
