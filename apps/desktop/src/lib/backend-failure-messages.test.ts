import { describe, expect, it } from "vitest";

import {
  formatCopyKeyToHostFailure,
  formatSnippetExecutionFailure,
} from "./backend-failure-messages";

describe("backend failure messages", () => {
  it("prefers structured failures over legacy prose", () => {
    expect(
      formatSnippetExecutionFailure({
        targetId: "host-1",
        label: "Build host",
        ok: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        failure: { reason: "ssh-failed", stage: "authentication" },
        errorMessage: "legacy raw ssh2 text",
      })
    ).toBe("Could not authenticate with Build host.");
    expect(
      formatCopyKeyToHostFailure({
        ok: false,
        failure: { reason: "public-key-unreadable", publicKeyPath: "~/.ssh/deploy.pub" },
        reason: "legacy raw fs text",
      })
    ).toBe("Could not read public key at ~/.ssh/deploy.pub.");
  });

  it("keeps the timeout budget, connection teardown, and rerun action", () => {
    expect(
      formatSnippetExecutionFailure({
        targetId: "host-1",
        label: "Build host",
        ok: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        failure: { reason: "timed-out", timeoutSeconds: 60 },
      })
    ).toBe(
      "Command did not finish within 60 seconds. The SSH connection was closed; verify the host before rerunning."
    );
    expect(
      formatCopyKeyToHostFailure({
        ok: false,
        failure: {
          reason: "remote-command-failed",
          hostname: "build.example",
          command: { reason: "timed-out", timeoutSeconds: 60 },
        },
      })
    ).toBe(
      "Public-key installation on build.example did not finish within 60 seconds. The SSH connection was closed; verify the host before rerunning."
    );
  });

  it("keeps process exit codes and handles signal exits without printing null", () => {
    expect(
      formatSnippetExecutionFailure({
        targetId: "host-1",
        label: "Build host",
        ok: false,
        stdout: "",
        stderr: "",
        exitCode: 23,
        failure: { reason: "remote-command-exited", exitCode: 23 },
      })
    ).toBe("Command exited with code 23.");
    expect(
      formatCopyKeyToHostFailure({
        ok: false,
        failure: {
          reason: "remote-command-failed",
          hostname: "build.example",
          command: { reason: "remote-command-exited", exitCode: 23 },
        },
      })
    ).toBe("Public-key installation on build.example exited with code 23.");
    expect(
      formatSnippetExecutionFailure({
        targetId: "host-1",
        label: "Build host",
        ok: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        failure: { reason: "remote-command-exited", exitCode: null },
      })
    ).toBe("The command failed without an exit code.");
    expect(
      formatCopyKeyToHostFailure({
        ok: false,
        failure: {
          reason: "remote-command-failed",
          hostname: "build.example",
          command: { reason: "remote-command-exited", exitCode: null },
        },
      })
    ).toBe("Public-key installation on build.example failed without an exit code.");
  });

  it("falls back to legacy native prose until #293 lands", () => {
    expect(
      formatSnippetExecutionFailure({
        targetId: "host-1",
        label: "Build host",
        ok: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        errorMessage: "Native backend failure.",
      })
    ).toBe("Native backend failure.");
    expect(formatCopyKeyToHostFailure({ ok: false, reason: "Native copy failure." })).toBe(
      "Native copy failure."
    );
  });
});
