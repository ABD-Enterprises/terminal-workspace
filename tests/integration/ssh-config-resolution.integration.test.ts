import { describe, expect, it } from "vitest";

import {
  resolveSshConfigPath,
  SshConfigResolutionFailure,
  SshConfigResolutionRegistry,
} from "../../apps/desktop/server/ssh-config-resolution.mjs";

const sshRoot = "/fixture/.ssh";

function registry(maxEntries = 2) {
  return new SshConfigResolutionRegistry({
    maxEntries,
    salt: Buffer.alloc(32, 7),
  });
}

describe("Node SSH config resolution registry", () => {
  it("rejects an unknown parent cycle key with a typed failure", () => {
    let failure: unknown;
    try {
      resolveSshConfigPath(
        "/fixture/.ssh/visible/child.conf",
        { parentCycleKey: "garbage", relativePath: "child.conf" },
        sshRoot,
        registry()
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(SshConfigResolutionFailure);
    expect(failure).toEqual(
      expect.objectContaining({
        reason: "invalid-path",
        path: "/fixture/.ssh/visible/child.conf",
        statusCode: 400,
      })
    );
    expect(JSON.parse(JSON.stringify(failure))).toEqual({
      reason: "invalid-path",
      path: "/fixture/.ssh/visible/child.conf",
    });
  });

  it("rejects a stale parent cycle key after LRU eviction", () => {
    const resolutions = registry();
    const staleKey = resolutions.remember(`${sshRoot}/first.conf`);
    resolutions.remember(`${sshRoot}/second.conf`);
    resolutions.remember(`${sshRoot}/third.conf`);

    expect(() =>
      resolveSshConfigPath(
        `${sshRoot}/child.conf`,
        { parentCycleKey: staleKey, relativePath: "child.conf" },
        sshRoot,
        resolutions
      )
    ).toThrow(
      expect.objectContaining({
        reason: "invalid-path",
        path: `${sshRoot}/child.conf`,
      })
    );
  });
});
