import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { buildHostSearchText, parseEnvironmentVariables, splitCommaList } from "../lib/utils";
import {
  defaultHostKeyPolicy,
  defaultHostProtocol,
  hostSupportsCredentialPrompt,
  hostSupportsJumpHosts,
  protocolDefaultPort,
  protocolRequiresUsername,
  hostSupportsSftp,
  hostSupportsTrustedKeys,
  sampleHosts,
  type HostFormValues,
  type HostKeyPolicy,
  type HostRecord,
} from "../types/host";
import { useVaultSyncStore } from "./vault-sync-store";

export interface HostFilters {
  query: string;
  activeGroup: string;
  activeTag: string;
  favoritesOnly: boolean;
}

function normalizeTags(tags: string[]) {
  return tags.filter((tag) => tag.trim() && tag.trim().toLowerCase() !== "favorite");
}

function normalizeEnvironment(environment: unknown) {
  if (!environment || typeof environment !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(environment)
      .map(([key, value]) => [key.trim(), typeof value === "string" ? value : String(value ?? "")])
      .filter(([key]) => Boolean(key))
  );
}

function normalizeHostRecord(host: HostRecord): HostRecord {
  const rest = { ...host } as HostRecord & {
    agentForwarding?: boolean;
    environment?: unknown;
    password?: string;
    passphrase?: string;
  };
  delete rest.password;
  delete rest.passphrase;

  return {
    ...rest,
    protocol: rest.protocol ?? defaultHostProtocol,
    hostKeyPolicy: (rest as HostRecord & { hostKeyPolicy?: HostKeyPolicy }).hostKeyPolicy ?? defaultHostKeyPolicy,
    agentForwarding: rest.agentForwarding ?? false,
    environment: normalizeEnvironment(rest.environment),
    tags: normalizeTags(Array.isArray(rest.tags) ? rest.tags : []),
    jumpHostId:
      hostSupportsJumpHosts(rest.protocol ?? defaultHostProtocol) && rest.jumpHostId
        ? rest.jumpHostId
        : undefined,
    sftpRoot:
      hostSupportsSftp(rest.protocol ?? defaultHostProtocol) && rest.sftpRoot?.trim()
        ? rest.sftpRoot
        : "",
  };
}

export function createHostRecord(values: HostFormValues, currentHost?: HostRecord): HostRecord {
  const now = new Date().toISOString();
  const protocol = values.protocol;
  const supportsCredentials = hostSupportsCredentialPrompt(protocol);
  const supportsJumpHosts = hostSupportsJumpHosts(protocol);
  const supportsTrustedKeys = hostSupportsTrustedKeys(protocol);
  const supportsSftp = hostSupportsSftp(protocol);

  return {
    id: currentHost?.id ?? crypto.randomUUID(),
    label: values.label.trim(),
    protocol,
    hostname: protocol === "localShell" ? "localhost" : values.hostname.trim(),
    username:
      protocol === "localShell"
        ? values.username.trim() || "local"
        : protocolRequiresUsername(protocol)
          ? values.username.trim()
          : "",
    port: Number.parseInt(values.port, 10) || protocolDefaultPort(protocol),
    authMethod: supportsCredentials ? values.authMethod : "none",
    privateKeyPath: supportsCredentials ? values.privateKeyPath.trim() : "",
    group: values.group.trim(),
    tags: normalizeTags(splitCommaList(values.tags)),
    note: values.note.trim(),
    favorite: values.favorite,
    keyLabel: supportsCredentials ? values.keyLabel.trim() : "",
    hostKeyPolicy: supportsTrustedKeys ? values.hostKeyPolicy : defaultHostKeyPolicy,
    agentForwarding: supportsCredentials ? values.agentForwarding : false,
    environment: parseEnvironmentVariables(values.environment),
    jumpHostId: supportsJumpHosts ? values.jumpHostId || undefined : undefined,
    sftpRoot: supportsSftp ? values.sftpRoot.trim() || "/home" : "",
    snippetCount: currentHost?.snippetCount ?? 0,
    forwardingCount: currentHost?.forwardingCount ?? 0,
    createdAt: currentHost?.createdAt ?? now,
    updatedAt: now,
    lastConnectedAt: currentHost?.lastConnectedAt,
    // P2-DM1 batch 2: form-supplied identityId wins, then existing host
    // value, else undefined. Empty string from the form means "explicitly
    // unbound" — drop to undefined so the persisted record stays sparse.
    identityId: values.identityId?.trim()
      ? values.identityId.trim()
      : currentHost?.identityId,
  };
}

export function upsertHostCollection(
  hosts: HostRecord[],
  values: HostFormValues,
  hostId?: string
) {
  if (!hostId) {
    return sortHostCollection([...hosts, createHostRecord(values)]);
  }

  return sortHostCollection(
    hosts.map((host) => (host.id === hostId ? createHostRecord(values, host) : host))
  );
}

export function deleteHostFromCollection(hosts: HostRecord[], hostId: string) {
  return sortHostCollection(hosts.filter((host) => host.id !== hostId));
}

export function toggleHostFavoriteInCollection(hosts: HostRecord[], hostId: string) {
  return sortHostCollection(
    hosts.map((host) =>
      host.id === hostId ? { ...host, favorite: !host.favorite, updatedAt: new Date().toISOString() } : host
    )
  );
}

export function markHostConnectedInCollection(hosts: HostRecord[], hostId: string) {
  return sortHostCollection(
    hosts.map((host) =>
      host.id === hostId ? { ...host, lastConnectedAt: new Date().toISOString() } : host
    )
  );
}

export function assignKeyInCollection(
  hosts: HostRecord[],
  hostId: string,
  key: { label: string; privateKeyPath: string }
) {
  return sortHostCollection(
    hosts.map((host) =>
      host.id === hostId
        ? {
            ...host,
            authMethod: "privateKey",
            keyLabel: key.label,
            privateKeyPath: key.privateKeyPath,
            protocol: host.protocol,
            updatedAt: new Date().toISOString(),
          }
        : host
    )
  );
}

export function clearKeyInCollection(hosts: HostRecord[], privateKeyPath: string) {
  return sortHostCollection(
    hosts.map((host) =>
      host.privateKeyPath === privateKeyPath
        ? {
            ...host,
            keyLabel: "",
            privateKeyPath: "",
            updatedAt: new Date().toISOString(),
          }
        : host
    )
  );
}

export function collectHostGroups(hosts: HostRecord[]) {
  return Array.from(new Set(hosts.map((host) => host.group).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right)
  );
}

export function collectHostTags(hosts: HostRecord[]) {
  return Array.from(new Set(hosts.flatMap((host) => host.tags))).sort((left, right) =>
    left.localeCompare(right)
  );
}

export function applyHostFilters(hosts: HostRecord[], filters: HostFilters) {
  const trimmedQuery = filters.query.trim().toLowerCase();

  return sortHostCollection(
    hosts.filter((host) => {
      if (filters.favoritesOnly && !host.favorite) {
        return false;
      }

      if (filters.activeGroup !== "all" && host.group !== filters.activeGroup) {
        return false;
      }

      if (filters.activeTag !== "all" && !host.tags.includes(filters.activeTag)) {
        return false;
      }

      if (!trimmedQuery) {
        return true;
      }

      return buildHostSearchText(host).includes(trimmedQuery);
    })
  );
}

export function sortHostCollection(hosts: HostRecord[]) {
  return [...hosts].map(normalizeHostRecord).sort((left, right) => {
    if (left.favorite !== right.favorite) {
      return left.favorite ? -1 : 1;
    }

    const leftActivity = left.lastConnectedAt ?? "";
    const rightActivity = right.lastConnectedAt ?? "";

    if (leftActivity !== rightActivity) {
      return rightActivity.localeCompare(leftActivity);
    }

    return left.label.localeCompare(right.label);
  });
}

const fallbackStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

interface HostsState {
  hosts: HostRecord[];
  createHost: (values: HostFormValues) => string;
  updateHost: (hostId: string, values: HostFormValues) => string;
  deleteHost: (hostId: string) => void;
  toggleFavorite: (hostId: string) => void;
  markConnected: (hostId: string) => void;
  setSnippetCounts: (counts: Record<string, number>) => void;
  assignKey: (hostId: string, key: { label: string; privateKeyPath: string }) => void;
  clearKeyByPath: (privateKeyPath: string) => void;
}

export const useHostsStore = create<HostsState>()(
  persist(
    (set) => ({
      hosts: sortHostCollection(sampleHosts),
      createHost: (values) => {
        const host = createHostRecord(values);
        set((state) => ({
          hosts: sortHostCollection([...state.hosts, host]),
        }));
        useVaultSyncStore.getState().clearDeleted("hosts", host.id);
        return host.id;
      },
      updateHost: (hostId, values) => {
        set((state) => ({
          hosts: upsertHostCollection(state.hosts, values, hostId),
        }));
        useVaultSyncStore.getState().clearDeleted("hosts", hostId);
        return hostId;
      },
      deleteHost: (hostId) =>
        set((state) => {
          useVaultSyncStore.getState().markDeleted("hosts", hostId);
          return {
            hosts: deleteHostFromCollection(state.hosts, hostId),
          };
        }),
      toggleFavorite: (hostId) =>
        set((state) => ({
          hosts: toggleHostFavoriteInCollection(state.hosts, hostId),
        })),
      markConnected: (hostId) =>
        set((state) => ({
          hosts: markHostConnectedInCollection(state.hosts, hostId),
        })),
      setSnippetCounts: (counts) =>
        set((state) => ({
          hosts: sortHostCollection(
            state.hosts.map((host) => ({
              ...host,
              snippetCount: counts[host.id] ?? 0,
            }))
          ),
        })),
      assignKey: (hostId, key) =>
        set((state) => ({
          hosts: assignKeyInCollection(state.hosts, hostId, key),
        })),
      clearKeyByPath: (privateKeyPath) =>
        set((state) => ({
          hosts: clearKeyInCollection(state.hosts, privateKeyPath),
        })),
    }),
    {
      name: "termsnip-hosts",
      version: 2,
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? fallbackStorage : window.localStorage
      ),
      migrate: (persistedState) => {
        const state = persistedState as Partial<HostsState> | undefined;

        return {
          ...state,
          hosts: sortHostCollection(state?.hosts ?? sampleHosts),
        };
      },
      merge: (persistedState, currentState) => {
        const persistedHosts =
          (persistedState as Partial<HostsState> | undefined)?.hosts ?? currentState.hosts;

        return {
          ...currentState,
          ...(persistedState as Partial<HostsState>),
          hosts: sortHostCollection(persistedHosts),
        };
      },
    }
  )
);
