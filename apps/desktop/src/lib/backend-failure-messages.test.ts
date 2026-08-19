import { describe, expect, it } from "vitest";

import {
  formatBackendFailure,
  formatCopyKeyToHostFailure,
  formatSnippetExecutionFailure,
  formatSshConfigCommandFailure,
} from "./backend-failure-messages";

describe("backend failure messages", () => {
  it("formats structured failures", () => {
    expect(
      formatSnippetExecutionFailure({
        targetId: "host-1",
        label: "Build host",
        ok: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        failure: { reason: "ssh-failed", stage: "authentication" },
      })
    ).toBe("Could not authenticate with Build host.");
    expect(
      formatCopyKeyToHostFailure({
        ok: false,
        failure: { reason: "public-key-unreadable", publicKeyPath: "~/.ssh/deploy.pub" },
      })
    ).toBe("Could not read public key at ~/.ssh/deploy.pub.");
  });

  it("formats structured key-command rejections from the caller's path", () => {
    expect(
      formatBackendFailure({
        reason: "path-outside-allowed-roots",
        path: "~/.ssh/../../shared/deploy",
      })
    ).toBe(
      "Private key path ~/.ssh/../../shared/deploy is outside the approved user-owned locations."
    );
    expect(
      formatBackendFailure({
        reason: "ssh-keygen-failed",
        operation: "inspect",
        path: "~/.ssh/broken",
      })
    ).toBe("ssh-keygen could not inspect the private key at ~/.ssh/broken.");
  });

  it("preserves string and Error failures outside the typed key commands", () => {
    expect(formatBackendFailure(new Error("Known-host scan failed"))).toBe(
      "Known-host scan failed"
    );
    expect(formatBackendFailure("Copy worker failed")).toBe("Copy worker failed");
  });

  it("keeps SSH config Include failures actionable for each operation", () => {
    const failure = {
      reason: "path-outside-ssh-root",
      path: "~/.ssh/linked-config",
    };

    expect(formatSshConfigCommandFailure(failure, "read")).toBe(
      "SSH config Include ~/.ssh/linked-config resolves outside ~/.ssh and was rejected."
    );
    expect(formatSshConfigCommandFailure(failure, "glob")).toBe(
      "SSH config Include glob ~/.ssh/linked-config resolves outside ~/.ssh and was rejected."
    );
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
});
