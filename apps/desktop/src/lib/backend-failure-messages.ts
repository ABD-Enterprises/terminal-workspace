import type {
  CopyKeyToHostResponse,
  RemoteCommandFailure,
  SnippetExecutionResult,
  SshFailureStage,
} from "./backend-contract";

function sshStageMessage(stage: SshFailureStage, host: string, copyKey: boolean) {
  switch (stage) {
    case "configuration":
      return `Could not prepare the SSH connection for ${host}.`;
    case "connect":
      return copyKey
        ? `Could not connect to ${host} to install the public key.`
        : `Could not connect to ${host}.`;
    case "session-initialization":
      return `Could not initialize the SSH session for ${host}.`;
    case "handshake":
      return `Could not complete the SSH handshake with ${host}.`;
    case "host-key-verification":
      return `Could not verify the host key for ${host}.`;
    case "authentication":
      return `Could not authenticate with ${host}.`;
    case "channel-open":
      return `Could not open a command channel on ${host}.`;
    case "exec-request":
      return copyKey
        ? `Could not start public-key installation on ${host}.`
        : `Could not start the command on ${host}.`;
    case "output-read":
      return `Could not read command output from ${host}.`;
  }
}

function remoteCommandMessage(failure: RemoteCommandFailure, host: string, copyKey = false) {
  switch (failure.reason) {
    case "ssh-failed":
      return sshStageMessage(failure.stage, host, copyKey);
    case "timed-out":
      return copyKey
        ? `Public-key installation on ${host} did not finish within ${failure.timeoutSeconds} seconds. The SSH connection was closed; verify the host before rerunning.`
        : `Command did not finish within ${failure.timeoutSeconds} seconds. The SSH connection was closed; verify the host before rerunning.`;
    case "remote-command-exited":
      if (failure.exitCode === null) {
        return copyKey
          ? `Public-key installation on ${host} failed without an exit code.`
          : "The command failed without an exit code.";
      }
      return copyKey
        ? `Public-key installation on ${host} exited with code ${failure.exitCode}.`
        : `Command exited with code ${failure.exitCode}.`;
    case "worker-failed":
      return `The command worker failed for ${host}.`;
  }
}

function legacyMessage(message: string | undefined, fallback: string) {
  // Rust backend structured-failure parity is #293, so native responses still
  // need their legacy prose field until that separate change lands.
  return message?.trim() || fallback;
}

export function formatSnippetExecutionFailure(result: SnippetExecutionResult) {
  if (result.ok) {
    return undefined;
  }
  if (result.failure) {
    return remoteCommandMessage(result.failure, result.label);
  }
  return legacyMessage(result.errorMessage, `Could not run the command on ${result.label}.`);
}

export function formatCopyKeyToHostFailure(result: CopyKeyToHostResponse) {
  if (result.ok) {
    return undefined;
  }
  switch (result.failure?.reason) {
    case "private-key-path-required":
      return "A private key path is required.";
    case "target-host-required":
      return "A target host is required.";
    case "public-key-unreadable":
      return `Could not read public key at ${result.failure.publicKeyPath}.`;
    case "public-key-empty":
      return `Public key at ${result.failure.publicKeyPath} is empty.`;
    case "remote-command-failed":
      return remoteCommandMessage(
        result.failure.command,
        result.failure.hostname,
        true
      );
    default:
      return legacyMessage(result.reason, "Copy failed.");
  }
}
