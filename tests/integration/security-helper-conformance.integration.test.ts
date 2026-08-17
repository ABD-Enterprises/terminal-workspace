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
