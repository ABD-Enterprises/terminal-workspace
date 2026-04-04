import type { BackendHostConnection } from "./api";
import type { HostRecord } from "../types/host";
import { getHostConnectionSecrets } from "../store/connection-secrets-store";
import { useHostsStore } from "../store/hosts-store";
import type { KnownHostRecord } from "../types/known-host";

type BackendConnectionHost = Pick<
  HostRecord,
  | "agentForwarding"
  | "authMethod"
  | "environment"
  | "hostKeyPolicy"
  | "id"
  | "hostname"
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

  if (host.protocol === "ssh" && host.hostKeyPolicy === "requireTrusted" && !knownHost) {
    throw new Error(
      `Trusted host key required for ${host.label}. Scan and trust ${host.hostname}:${host.port} in Keys before connecting.`
    );
  }

  let jumpHost: BackendHostConnection | undefined;
  if (host.protocol === "ssh" && host.jumpHostId) {
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
    authMethod: host.authMethod,
    environment: host.environment,
    hostname: host.hostname,
    jumpHost,
    knownHostAlgorithm: knownHost?.algorithm,
    knownHostPublicKey: knownHost?.publicKey,
    password: secrets.password,
    passphrase: secrets.passphrase,
    port: host.port,
    privateKeyPath: host.privateKeyPath,
    protocol: host.protocol,
    sftpRoot: host.protocol === "ssh" ? host.sftpRoot : undefined,
    username: host.username,
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
