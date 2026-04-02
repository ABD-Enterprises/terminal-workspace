import { requestConnectionSecretsPrompt } from "../store/connection-secret-prompt-utils";
import { isDemoModeEnabled } from "../store/app-store";
import {
  getHostConnectionSecrets,
  hydrateHostConnectionSecrets,
} from "../store/connection-secrets-store";
import { useHostsStore } from "../store/hosts-store";
import { useKeysStore } from "../store/keys-store";
import type { HostRecord } from "../types/host";

export interface HostSecretRequirement {
  needsPassword: boolean;
  needsPassphrase: boolean;
}

function resolveConnectionChain(host: HostRecord) {
  const hostsById = new Map(useHostsStore.getState().hosts.map((entry) => [entry.id, entry]));
  const chain: HostRecord[] = [];
  const visitedHostIds = new Set<string>();
  let currentHost: HostRecord | undefined = host;

  while (currentHost) {
    if (visitedHostIds.has(currentHost.id)) {
      throw new Error(`Jump host cycle detected for ${currentHost.label}.`);
    }

    visitedHostIds.add(currentHost.id);
    chain.unshift(currentHost);
    currentHost = currentHost.jumpHostId ? hostsById.get(currentHost.jumpHostId) : undefined;
  }

  return chain;
}

export function getHostSecretRequirement(host: HostRecord): HostSecretRequirement {
  if (isDemoModeEnabled()) {
    return {
      needsPassword: false,
      needsPassphrase: false,
    };
  }

  const secrets = getHostConnectionSecrets(host.id);
  const assignedKey = useKeysStore
    .getState()
    .keys.find((key) => key.privateKeyPath === host.privateKeyPath);

  return {
    needsPassword: host.authMethod === "password" && !secrets.password,
    needsPassphrase:
      host.authMethod === "privateKey" && Boolean(assignedKey?.hasPassphrase) && !secrets.passphrase,
  };
}

async function hydrateConnectionSecrets(host: HostRecord) {
  for (const entry of resolveConnectionChain(host)) {
    await hydrateHostConnectionSecrets(entry.id);
  }
}

export async function canRestoreSessionWithoutPrompt(host: HostRecord) {
  if (isDemoModeEnabled()) {
    return true;
  }

  await hydrateConnectionSecrets(host);

  return resolveConnectionChain(host).every((entry) => {
    const requirement = getHostSecretRequirement(entry);
    return !requirement.needsPassword && !requirement.needsPassphrase;
  });
}

export async function ensureRuntimeSecrets(
  host: HostRecord,
  actionLabel: string
) {
  if (isDemoModeEnabled()) {
    return true;
  }

  for (const entry of resolveConnectionChain(host)) {
    await hydrateHostConnectionSecrets(entry.id);
    const requirement = getHostSecretRequirement(entry);

    if (!requirement.needsPassword && !requirement.needsPassphrase) {
      continue;
    }

    const approved = await requestConnectionSecretsPrompt({
      actionLabel,
      hostId: entry.id,
      hostLabel: entry.label,
      hostname: entry.hostname,
      username: entry.username,
      needsPassword: requirement.needsPassword,
      needsPassphrase: requirement.needsPassphrase,
    });

    if (!approved) {
      return false;
    }
  }

  return true;
}
