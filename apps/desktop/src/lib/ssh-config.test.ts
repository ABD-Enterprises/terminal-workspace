import { describe, expect, it } from "vitest";
import { parseSshConfig } from "./ssh-config";

describe("parseSshConfig", () => {
  it("parses host aliases, defaults, and jump hosts from OpenSSH config", () => {
    const parsed = parseSshConfig(`
Host *
  User ops
  IdentityFile ~/.ssh/id_default

Host prod-gateway
  HostName bastion.acme.internal
  Port 2222

Host billing-api workers
  HostName billing-api-02.use1.internal
  User deploy
  ProxyJump prod-gateway
  IdentityFile ~/.ssh/deploy_key

Host *.internal
  User ignored
`);

    expect(parsed).toEqual([
      {
        alias: "billing-api",
        hostname: "billing-api-02.use1.internal",
        username: "deploy",
        port: 22,
        privateKeyPath: "~/.ssh/deploy_key",
        jumpHostAlias: "prod-gateway",
      },
      {
        alias: "prod-gateway",
        hostname: "bastion.acme.internal",
        username: "ops",
        port: 2222,
        privateKeyPath: "~/.ssh/id_default",
        jumpHostAlias: undefined,
      },
      {
        alias: "workers",
        hostname: "billing-api-02.use1.internal",
        username: "deploy",
        port: 22,
        privateKeyPath: "~/.ssh/deploy_key",
        jumpHostAlias: "prod-gateway",
      },
    ]);
  });
});

