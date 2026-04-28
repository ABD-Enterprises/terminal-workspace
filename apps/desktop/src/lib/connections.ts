import type { BackendHostConnection } from "./api";
import { hostSupportsJumpHosts, hostSupportsTrustedKeys, type HostRecord } from "../types/host";
import { getHostConnectionSecrets } from "../store/connection-secrets-store";
import { useHostsStore } from "../store/hosts-store";
import { useIdentitiesStore } from "../store/identities-store";
import { resolveIdentityForHost } from "./host-identity-resolver";
import type { KnownHostRecord } from "../types/known-host";

type BackendConnectionHost = Pick<
  HostRecord,
  | "agentForwarding"
  | "authMethod"
  | "environment"
  | "hostKeyPolicy"
  | "id"
  | "hostname"
  | "identityId"
  | "label"
  | "port"
  | "privateKeyPath"
  | "jumpHostId"
  | "sftpRoot"
  | "protocol"
  | "username"
>;

export function findKnownHostMatch(
  knownHosts: KnownHostRecord[],
  host: Pick<HostRecord, "hostname" | "port">
) {
  return knownHosts.find((knownHost) => knownHost.hostname === host.hostname && knownHost.port === host.port);
}

function buildBackendConnectionRecursive(
  host: BackendConnectionHost,
  knownHosts: KnownHostRecord[],
  chainHostIds = new Set<string>()
): BackendHostConnection {
  if (chainHostIds.has(host.id)) {
    throw new Error(`Jump host cycle detected for ${host.label}.`);
  }

  const knownHost = findKnownHostMatch(knownHosts, host);
  const secrets = getHostConnectionSecrets(host.id);

  if (hostSupportsTrustedKeys(host.protocol) && host.hostKeyPolicy === "requireTrusted" && !knownHost) {
    throw new Error(
      `Trusted host key required for ${host.label}. Scan and trust ${host.hostname}:${host.port} in Keys before connecting.`
    );
  }

  // P2-DM1 batch 3: prefer identity-supplied credential fields when the host
  // is bound to a reusable identity. Falls back to the per-host fields when
  // there is no identity (transitional). The host-record fields stay
  // populated by the editor so a partially-migrated workspace keeps working.
  const identity = resolveIdentityForHost(host, useIdentitiesStore.getState().identities);
  const effectiveUsername = identity?.username?.trim() || host.username;
  const effectiveAuthMethod = identity?.authMethod ?? host.authMethod;
  const effectivePrivateKeyPath = identity
    ? identity.authMethod === "privateKey"
      ? identity.privateKeyPath || host.privateKeyPath
      : "" // identity is bound but does not use a key — clear the path
    : host.privateKeyPath;

  let jumpHost: BackendHostConnection | undefined;
  if (hostSupportsJumpHosts(host.protocol) && host.jumpHostId) {
    const resolvedJumpHost = useHostsStore
      .getState()
      .hosts.find((candidate) => candidate.id === host.jumpHostId);
    if (!resolvedJumpHost) {
      throw new Error(`Jump host is missing for ${host.label}.`);
    }

    jumpHost = buildBackendConnectionRecursive(
      resolvedJumpHost,
      knownHosts,
      new Set([...chainHostIds, host.id])
    );
  }

  return {
    agentForwarding: host.agentForwarding,
    authMethod: effectiveAuthMethod,
    environment: host.environment,
    hostKeyPolicy: host.hostKeyPolicy,
    hostname: host.hostname,
    jumpHost,
    knownHostAlgorithm: knownHost?.algorithm,
    knownHostPublicKey: knownHost?.publicKey,
    password: secrets.password,
    passphrase: secrets.passphrase,
    port: host.port,
    privateKeyPath: effectivePrivateKeyPath,
    protocol: host.protocol,
    sftpRoot: host.protocol === "ssh" ? host.sftpRoot : undefined,
    username: effectiveUsername,
  };
}

export function buildBackendConnectionFromKnownHost(
  host: BackendConnectionHost,
  knownHost?: Pick<KnownHostRecord, "algorithm" | "publicKey">
): BackendHostConnection {
  const knownHosts = knownHost
    ? [
        {
          algorithm: knownHost.algorithm,
          fingerprint: "",
          hostname: host.hostname,
          id: `${host.hostname}:${host.port}:known`,
          port: host.port,
          publicKey: knownHost.publicKey,
          trustedAt: "",
          updatedAt: "",
        } satisfies KnownHostRecord,
      ]
    : [];

  return buildBackendConnectionRecursive(host, knownHosts);
}

export function buildBackendConnection(host: BackendConnectionHost, knownHosts: KnownHostRecord[]) {
  return buildBackendConnectionRecursive(host, knownHosts);
}
