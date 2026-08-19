import type {
  CopyKeyToHostResponse,
  KeyCommandFailure,
  RemoteCommandFailure,
  SnippetExecutionResult,
  SshConfigCommandFailure,
  SshConfigCommandOperation,
  SshFailureStage,
} from "./backend-contract";

function pathFailure(
  error: Record<string, unknown>
): error is Record<string, unknown> & { path: string } {
  return typeof error.path === "string";
}

function keyCommandFailureMessage(error: unknown) {
  if (typeof error !== "object" || error === null || !("reason" in error)) {
    return undefined;
  }

  const failure = error as Record<string, unknown>;
  switch (failure.reason) {
    case "path-required":
      return "A private key path is required.";
    case "key-body-required":
      return "A private key body is required.";
    case "path-must-be-absolute":
      return pathFailure(failure)
        ? `Private key path ${failure.path} must be absolute or start with ~/.`
        : undefined;
    case "path-outside-allowed-roots":
      return pathFailure(failure)
        ? `Private key path ${failure.path} is outside the approved user-owned locations.`
        : undefined;
    case "parent-directory-unavailable":
      return pathFailure(failure)
        ? `Could not create the parent directory for ${failure.path}.`
        : undefined;
    case "path-already-exists":
      return pathFailure(failure) ? `A key already exists at ${failure.path}.` : undefined;
    case "private-key-unreadable":
      return pathFailure(failure) ? `Could not read private key at ${failure.path}.` : undefined;
    case "private-key-write-failed":
      return pathFailure(failure) ? `Could not write private key at ${failure.path}.` : undefined;
    case "unsupported-key-type":
      return "Choose an ED25519, ECDSA, or RSA key type.";
    case "ssh-keygen-unavailable":
      if (!pathFailure(failure)) {
        return undefined;
      }
      return `Could not start ssh-keygen for ${failure.path}.`;
    case "ssh-keygen-failed":
      if (!pathFailure(failure)) {
        return undefined;
      }
      return failure.operation === "generate"
        ? `ssh-keygen could not generate a private key at ${failure.path}.`
        : `ssh-keygen could not inspect the private key at ${failure.path}.`;
    case "invalid-key-metadata":
      return pathFailure(failure)
        ? `ssh-keygen returned invalid metadata for ${failure.path}.`
        : undefined;
    case "worker-failed":
      return pathFailure(failure)
        ? `The private-key operation failed for ${failure.path}.`
        : undefined;
    default:
      return undefined;
  }
}

export function formatBackendFailure(error: unknown) {
  const keyCommandMessage = keyCommandFailureMessage(error as KeyCommandFailure);
  if (keyCommandMessage) {
    return keyCommandMessage;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "The backend request failed.";
}

function sshConfigCommandFailureMessage(
  error: unknown,
  operation: SshConfigCommandOperation
) {
  if (typeof error !== "object" || error === null || !("reason" in error)) {
    return undefined;
  }

  const failure = error as Record<string, unknown>;
  if (!pathFailure(failure)) {
    return undefined;
  }

  const path = failure.path;
  const target = operation === "read" ? `SSH config Include ${path}` : `SSH config Include glob ${path}`;
  switch (failure.reason) {
    case "ssh-root-unavailable":
      return `Could not access ~/.ssh while processing ${target}.`;
    case "invalid-path":
      return `${target} is not a valid path.`;
    case "path-unavailable":
      return `Could not resolve ${target}.`;
    case "path-outside-ssh-root":
      return `${target} resolves outside ~/.ssh and was rejected.`;
    case "path-not-regular-file":
      return `${target} is not a regular file.`;
    case "size-limit-exceeded":
      return `${target} exceeds the 1 MiB size limit.`;
    case "read-failed":
      return `Could not read ${target}.`;
    case "glob-in-directory-component":
      return `${target} has a wildcard in a directory component; only filename wildcards are supported.`;
    case "worker-failed":
      return `The SSH config ${operation} operation failed for ${path}.`;
    default:
      return undefined;
  }
}

export function formatSshConfigCommandFailure(
  error: unknown,
  operation: SshConfigCommandOperation
) {
  const message = sshConfigCommandFailureMessage(error as SshConfigCommandFailure, operation);
  if (message) {
    return message;
  }
  return operation === "read"
    ? "The SSH config Include could not be read."
    : "The SSH config Include glob could not be expanded.";
}

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

export function formatSnippetExecutionFailure(result: SnippetExecutionResult) {
  if (result.ok) {
    return undefined;
  }
  return remoteCommandMessage(result.failure, result.label);
}

export function formatCopyKeyToHostFailure(result: CopyKeyToHostResponse) {
  if (result.ok) {
    return undefined;
  }
  switch (result.failure.reason) {
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
  }
}
