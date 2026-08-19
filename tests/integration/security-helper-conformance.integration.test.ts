import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  normalizeRemotePath,
  resolveRemotePath,
  sanitizeFilename,
} from "../../apps/desktop/server/backend-paths.mjs";
import {
  buildEnvironmentExportPrefix,
  buildExecCommand,
  buildInteractiveShellCommand,
  getChannelEnvironment,
  shellSingleQuote,
} from "../../apps/desktop/server/backend-shell.mjs";
import { createBackendCommandOperations } from "../../apps/desktop/server/backend-command-operations.mjs";
import { OperationTimeoutError } from "../../apps/desktop/server/backend-deadline.mjs";
import type {
  CopyKeyToHostFailure,
  RemoteCommandFailure,
  SshFailureStage,
} from "../../apps/desktop/src/lib/backend-contract";

// #155: the JS half of the cross-backend conformance suite. The Rust half is
// src-tauri/src/native_transport_conformance_tests.rs and reads the SAME file.
//
// These helpers existed independently in both backends with nothing executing
// the same inputs against both, and they had drifted: `/a/b/` kept its trailing
// slash here but not in Rust, `.` became `/.`, a whitespace-only path resolved
// to `/srv/   `, an emoji became two underscores instead of one, and the shell
// quoting used a different (equally safe, textually different) spelling.
//
// Change a helper on either side and the other side's test fails until they
// agree again.

interface Case {
  why: string;
  [key: string]: unknown;
}

type ResponsePath = "node-snippet" | "node-copy-key" | "native-snippet" | "native-copy-key";
type NodeResponsePath = Extract<ResponsePath, `node-${string}`>;

const RESPONSE_PATHS = new Set<ResponsePath>([
  "node-snippet",
  "node-copy-key",
  "native-snippet",
  "native-copy-key",
]);
const NODE_SSH_FAILURE_STAGES = new Set<SshFailureStage>([
  "configuration",
  "connect",
  "handshake",
  "host-key-verification",
  "authentication",
  "exec-request",
]);

const fixture = JSON.parse(
  readFileSync("tests/fixtures/security-helper-conformance.json", "utf8")
) as Record<string, Case[]>;

/** A silently empty group would make this suite pass while proving nothing. */
function cases(group: string): Case[] {
  const list = fixture[group];
  expect(Array.isArray(list), `fixture is missing the \`${group}\` group`).toBe(true);
  expect(list.length, `\`${group}\` must not be empty`).toBeGreaterThan(0);
  return list;
}

function reachability(item: Case): ResponsePath[] {
  expect(Array.isArray(item.reachableBy), "case is missing `reachableBy`").toBe(true);
  expect((item.reachableBy as unknown[]).length, "`reachableBy` must not be empty").toBeGreaterThan(
    0
  );
  expect(
    (item.reachableBy as unknown[]).every(
      (backend) => typeof backend === "string" && RESPONSE_PATHS.has(backend as ResponsePath)
    ),
    "every `reachableBy` entry must name a known response path"
  ).toBe(true);
  return item.reachableBy as ResponsePath[];
}

function sshFailureStage(value: unknown): SshFailureStage {
  switch (value) {
    case "configuration":
    case "connect":
    case "session-initialization":
    case "handshake":
    case "host-key-verification":
    case "authentication":
    case "channel-open":
    case "exec-request":
    case "output-read":
      return value;
    default:
      throw new Error(`unknown SSH failure stage: ${String(value)}`);
  }
}

/** Native-only cases have no Node producer to exercise; this is deliberately type-level only. */
function typeOnlyRemoteCommandFailure(item: Record<string, unknown>): RemoteCommandFailure {
  switch (item.variant) {
    case "ssh-failed":
      return { reason: "ssh-failed", stage: sshFailureStage(item.stage) };
    case "timed-out":
      return { reason: "timed-out", timeoutSeconds: item.timeoutSeconds as number };
    case "worker-failed":
      return { reason: "worker-failed" };
    case "remote-command-exited":
      return {
        reason: "remote-command-exited",
        exitCode: item.exitCode as number | null,
      };
    default:
      throw new Error(`unknown remote-command failure variant: ${String(item.variant)}`);
  }
}

/** Native-only cases have no Node producer to exercise; this is deliberately type-level only. */
function typeOnlyCopyKeyFailure(item: Case): CopyKeyToHostFailure {
  switch (item.variant) {
    case "private-key-path-required":
      return { reason: "private-key-path-required" };
    case "target-host-required":
      return { reason: "target-host-required" };
    case "public-key-unreadable":
      return {
        reason: "public-key-unreadable",
        publicKeyPath: item.publicKeyPath as string,
      };
    case "public-key-empty":
      return {
        reason: "public-key-empty",
        publicKeyPath: item.publicKeyPath as string,
      };
    case "remote-command-failed":
      return {
        reason: "remote-command-failed",
        hostname: item.hostname as string,
        command: typeOnlyRemoteCommandFailure(item.command as Record<string, unknown>),
      };
    default:
      throw new Error(`unknown copy-key failure variant: ${String(item.variant)}`);
  }
}

function injectedRemoteCommandFailure(item: Record<string, unknown>) {
  return async (
    _target: unknown,
    _command: string,
    setStage: (stage: SshFailureStage) => void
  ) => {
    switch (item.variant) {
      case "ssh-failed": {
        const stage = sshFailureStage(item.stage);
        if (!NODE_SSH_FAILURE_STAGES.has(stage)) {
          throw new Error(`Node cannot produce an ssh-failed response at stage ${stage}`);
        }
        if (stage !== "configuration") {
          setStage(stage);
        }
        throw new Error("injected SSH failure");
      }
      case "timed-out":
        throw new OperationTimeoutError(
          "injected remote-command timeout",
          (item.timeoutSeconds as number) * 1000
        );
      case "remote-command-exited":
        return {
          ok: false,
          stdout: "",
          stderr: "",
          exitCode: item.exitCode as number | null,
        };
      default:
        throw new Error(`Node cannot produce ${String(item.variant)}`);
    }
  };
}

function operationsForRemoteCommandFailure(item: Record<string, unknown>) {
  return createBackendCommandOperations({
    expandHome: (path: string) => path,
    readFile: async () => "ssh-ed25519 conformance-key",
    runRemoteCommand: injectedRemoteCommandFailure(item),
  });
}

async function nodeProducedRemoteCommandFailure(
  item: Record<string, unknown>,
  path: NodeResponsePath
): Promise<RemoteCommandFailure> {
  const operations = operationsForRemoteCommandFailure(item);
  if (path === "node-snippet") {
    const response = await operations.executeRemoteCommand(
      {
        id: "conformance-target",
        label: "Conformance target",
        host: { hostname: "conformance.example" },
      },
      "true"
    );
    expect(response.ok, "the injected Node snippet command must fail").toBe(false);
    expect(response.failure, "the Node snippet producer must attach a failure").toBeDefined();
    return response.failure;
  }

  const response = await operations.copyKeyToHostBackend({
    privateKeyPath: "~/.ssh/conformance",
    host: { hostname: "conformance.example" },
  });
  expect(response.ok, "the injected Node copy-key command must fail").toBe(false);
  expect(response.failure?.reason, "copy-key must wrap its command failure").toBe(
    "remote-command-failed"
  );
  return response.failure.command;
}

async function nodeProducedCopyKeyFailure(item: Case): Promise<CopyKeyToHostFailure> {
  const unexpectedRemoteCommand = async () => {
    throw new Error("copy-key unexpectedly reached the remote command");
  };
  let response;

  switch (item.variant) {
    case "private-key-path-required":
      response = await createBackendCommandOperations({
        expandHome: (path: string) => path,
        readFile: async () => {
          throw new Error("copy-key unexpectedly read a public key");
        },
        runRemoteCommand: unexpectedRemoteCommand,
      }).copyKeyToHostBackend({ privateKeyPath: undefined, host: { hostname: "host.example" } });
      break;
    case "target-host-required":
      response = await createBackendCommandOperations({
        expandHome: (path: string) => path,
        readFile: async () => {
          throw new Error("copy-key unexpectedly read a public key");
        },
        runRemoteCommand: unexpectedRemoteCommand,
      }).copyKeyToHostBackend({ privateKeyPath: "~/.ssh/deploy", host: {} });
      break;
    case "public-key-unreadable":
      response = await createBackendCommandOperations({
        expandHome: (path: string) => path,
        readFile: async () => {
          throw new Error("injected public-key read failure");
        },
        runRemoteCommand: unexpectedRemoteCommand,
      }).copyKeyToHostBackend({
        privateKeyPath: (item.publicKeyPath as string).replace(/\.pub$/, ""),
        host: { hostname: "host.example" },
      });
      break;
    case "public-key-empty":
      response = await createBackendCommandOperations({
        expandHome: (path: string) => path,
        readFile: async () => " \n",
        runRemoteCommand: unexpectedRemoteCommand,
      }).copyKeyToHostBackend({
        privateKeyPath: (item.publicKeyPath as string).replace(/\.pub$/, ""),
        host: { hostname: "host.example" },
      });
      break;
    case "remote-command-failed":
      response = await operationsForRemoteCommandFailure(
        item.command as Record<string, unknown>
      ).copyKeyToHostBackend({
        privateKeyPath: "~/.ssh/deploy",
        host: { hostname: item.hostname as string },
      });
      break;
    default:
      throw new Error(`Node cannot produce copy-key failure ${String(item.variant)}`);
  }

  expect(response.ok, "the injected Node copy-key operation must fail").toBe(false);
  expect(response.failure, "the Node copy-key producer must attach a failure").toBeDefined();
  return response.failure;
}

function serialized(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Fixture environments are ordered PAIRS. Building the object in that order and
 * expecting sorted output is what proves the sort happens rather than the input
 * merely arriving pre-sorted.
 */
function toEnvironment(pairs: unknown): Record<string, string> {
  return Object.fromEntries(pairs as [string, string][]);
}

describe("#155: JS helpers match the shared cross-backend corpus", () => {
  it("normalizeRemotePath", () => {
    for (const item of cases("normalizeRemotePath")) {
      expect(normalizeRemotePath(item.input as string), item.why).toBe(item.expected);
    }
  });

  it("resolveRemotePath", () => {
    for (const item of cases("resolveRemotePath")) {
      expect(resolveRemotePath(item.root as string, item.input as string), item.why).toBe(
        item.expected
      );
    }
  });

  it("sanitizeFilename", () => {
    for (const item of cases("sanitizeFilename")) {
      expect(sanitizeFilename(item.input as string), item.why).toBe(item.expected);
    }
  });

  it("shellSingleQuote", () => {
    for (const item of cases("shellSingleQuote")) {
      expect(shellSingleQuote(item.input as string), item.why).toBe(item.expected);
    }
  });

  it("environment filtering, ordering, and command building", () => {
    for (const item of cases("environment")) {
      const environment = toEnvironment(item.input);
      const expectedEntries = item.expectedEntries as [string, string][];

      const actual = getChannelEnvironment(environment);
      expect(Object.entries(actual ?? {}), `entries — ${item.why}`).toEqual(expectedEntries);

      expect(buildEnvironmentExportPrefix(environment), `export prefix — ${item.why}`).toBe(
        item.expectedExportPrefix
      );

      // Rust returns Option<String>; JS returns string | undefined. That
      // representation difference is intended, so both are compared as
      // "value or null".
      expect(
        buildInteractiveShellCommand(environment) ?? null,
        `interactive shell command — ${item.why}`
      ).toBe(item.expectedInteractiveShellCommand ?? null);

      expect(
        buildExecCommand(item.command as string, environment),
        `exec command — ${item.why}`
      ).toBe(item.expectedExecCommand);
    }
  });

  // Every Node-reachable case must pass through the real response producer.
  // Native-only cases remain explicit type-level serialization checks because
  // there is no Node producer for them to exercise.
  it("copy-key failure serialization and reachability", async () => {
    for (const item of cases("copyKeyFailures")) {
      const nodePaths = reachability(item).filter(
        (path): path is NodeResponsePath => path === "node-snippet" || path === "node-copy-key"
      );
      if (nodePaths.length === 0) {
        expect(serialized(typeOnlyCopyKeyFailure(item)), `native-only type construction — ${item.why}`).toEqual(
          item.expected
        );
        continue;
      }
      for (const path of nodePaths) {
        expect(path, "copy-key failures cannot be emitted by the snippet path").toBe(
          "node-copy-key"
        );
        expect(
          serialized(await nodeProducedCopyKeyFailure(item)),
          `${path} producer — ${item.why}`
        ).toEqual(item.expected);
      }
    }
  });

  it("remote-command failure serialization and reachability", async () => {
    for (const item of cases("remoteCommandFailures")) {
      const nodePaths = reachability(item).filter(
        (path): path is NodeResponsePath => path === "node-snippet" || path === "node-copy-key"
      );
      if (nodePaths.length === 0) {
        expect(
          serialized(typeOnlyRemoteCommandFailure(item)),
          `native-only type construction — ${item.why}`
        ).toEqual(item.expected);
        continue;
      }
      for (const path of nodePaths) {
        expect(
          serialized(await nodeProducedRemoteCommandFailure(item, path)),
          `${path} producer — ${item.why}`
        ).toEqual(item.expected);
      }
    }
  });

  it("quoted values round-trip through a real shell as one literal word", () => {
    // Asserting the spelling alone would pass for a spelling that is wrong.
    for (const item of cases("shellSingleQuote")) {
      const input = item.input as string;
      const stdout = execFileSync("/bin/sh", ["-c", `printf %s ${shellSingleQuote(input)}`], {
        encoding: "utf8",
      });
      expect(stdout, `${input} must survive the shell intact`).toBe(input);
    }
  });
});
