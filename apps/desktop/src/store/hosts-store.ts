import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { parseSshConfig } from "../lib/ssh-config";
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
import {
  defaultHostEnvironmentKind,
  type HostEnvironmentFormValues,
  type HostEnvironmentKind,
  type HostEnvironmentRecord,
} from "../types/environment";
import { useVaultSyncStore } from "./vault-sync-store";

export interface HostFilters {
  query: string;
  activeEnvironmentId: string;
  activeTag: string;
  favoritesOnly: boolean;
}

export interface HostEnvironmentSection {
  environment: HostEnvironmentRecord | null;
  hosts: HostRecord[];
}

const defaultEnvironmentNow = "2026-04-17T00:00:00.000Z";

export const sampleEnvironments: HostEnvironmentRecord[] = sortEnvironmentCollection([
  {
    id: "env-acme-account",
    label: "Acme Production Account",
    kind: "account",
    description: "Customer-facing production AWS account and bastion tier.",
    createdAt: defaultEnvironmentNow,
    updatedAt: defaultEnvironmentNow,
  },
  {
    id: "env-services-cluster",
    label: "Services Cluster",
    kind: "cluster",
    description: "Application service nodes used for deploy rehearsal and runtime checks.",
    createdAt: defaultEnvironmentNow,
    updatedAt: defaultEnvironmentNow,
  },
  {
    id: "env-east-region",
    label: "us-east-1 Edge",
    kind: "region",
    description: "Regional edge and network validation inventory.",
    createdAt: defaultEnvironmentNow,
    updatedAt: defaultEnvironmentNow,
  },
  {
    id: "env-local-workstation",
    label: "Local Workstation",
    kind: "custom",
    description: "Native local shell and workstation tooling.",
    createdAt: defaultEnvironmentNow,
    updatedAt: defaultEnvironmentNow,
  },
]);

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

function slugifyEnvironmentLabel(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildEnvironmentId(label: string, takenIds: Set<string>) {
  const base = `env-${slugifyEnvironmentLabel(label) || "custom"}`;

  if (!takenIds.has(base)) {
    takenIds.add(base);
    return base;
  }

  let suffix = 2;
  while (takenIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }

  const nextId = `${base}-${suffix}`;
  takenIds.add(nextId);
  return nextId;
}

function normalizeHostRecord(host: HostRecord): HostRecord {
  const rest = { ...host } as HostRecord & {
    agentForwarding?: boolean;
    environment?: unknown;
    environmentId?: unknown;
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
    environmentId: typeof rest.environmentId === "string" && rest.environmentId.trim() ? rest.environmentId : undefined,
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

function normalizeEnvironmentRecord(environment: HostEnvironmentRecord): HostEnvironmentRecord {
  return {
    ...environment,
    label: environment.label.trim(),
    description: environment.description.trim(),
    kind: environment.kind ?? defaultHostEnvironmentKind,
  };
}

export function sortEnvironmentCollection(environments: HostEnvironmentRecord[]) {
  return [...environments]
    .map(normalizeEnvironmentRecord)
    .filter((environment) => Boolean(environment.label))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function createEnvironmentRecord(
  values: HostEnvironmentFormValues,
  currentEnvironment?: HostEnvironmentRecord
): HostEnvironmentRecord {
  const now = new Date().toISOString();

  return {
    id: currentEnvironment?.id ?? crypto.randomUUID(),
    label: values.label.trim(),
    kind: values.kind,
    description: values.description.trim(),
    createdAt: currentEnvironment?.createdAt ?? now,
    updatedAt: now,
  };
}

function ensureEnvironmentState(
  hosts: HostRecord[],
  environments: HostEnvironmentRecord[]
): { environments: HostEnvironmentRecord[]; hosts: HostRecord[] } {
  const normalizedHosts = hosts.map(normalizeHostRecord);
  const nextEnvironments = sortEnvironmentCollection([...environments]);
  const takenIds = new Set(nextEnvironments.map((environment) => environment.id));
  const environmentsById = new Map(nextEnvironments.map((environment) => [environment.id, environment]));
  const labelToId = new Map(
    nextEnvironments.map((environment) => [environment.label.toLowerCase(), environment.id])
  );

  const ensuredHosts = normalizedHosts.map((host) => {
    if (host.environmentId && environmentsById.has(host.environmentId)) {
      return host;
    }

    const fallbackLabel = host.group.trim() || "Ungrouped";
    const existingEnvironmentId = labelToId.get(fallbackLabel.toLowerCase());

    if (existingEnvironmentId) {
      return {
        ...host,
        environmentId: existingEnvironmentId,
      };
    }

    const nextEnvironmentId = host.environmentId && !takenIds.has(host.environmentId)
      ? host.environmentId
      : buildEnvironmentId(fallbackLabel, takenIds);
    const nextEnvironment: HostEnvironmentRecord = {
      id: nextEnvironmentId,
      label: fallbackLabel,
      kind: defaultHostEnvironmentKind,
      description:
        fallbackLabel === "Ungrouped"
          ? "Hosts that are not yet assigned to a named environment."
          : `Derived from legacy host grouping: ${fallbackLabel}.`,
      createdAt: defaultEnvironmentNow,
      updatedAt: defaultEnvironmentNow,
    };

    nextEnvironments.push(nextEnvironment);
    environmentsById.set(nextEnvironment.id, nextEnvironment);
    labelToId.set(nextEnvironment.label.toLowerCase(), nextEnvironment.id);

    return {
      ...host,
      environmentId: nextEnvironment.id,
    };
  });

  return {
    environments: sortEnvironmentCollection(nextEnvironments),
    hosts: sortHostCollection(ensuredHosts),
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
    environmentId: values.environmentId.trim() || undefined,
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

export function collectHostEnvironments(environments: HostEnvironmentRecord[]) {
  return sortEnvironmentCollection(environments);
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

      if (filters.activeEnvironmentId !== "all" && host.environmentId !== filters.activeEnvironmentId) {
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

export function buildHostEnvironmentSections(
  hosts: HostRecord[],
  environments: HostEnvironmentRecord[]
) {
  const sections = new Map<string, HostEnvironmentSection>();
  const sortedEnvironments = sortEnvironmentCollection(environments);

  sortedEnvironments.forEach((environment) => {
    sections.set(environment.id, {
      environment,
      hosts: [],
    });
  });

  sortHostCollection(hosts).forEach((host) => {
    if (host.environmentId && sections.has(host.environmentId)) {
      sections.get(host.environmentId)?.hosts.push(host);
      return;
    }

    const fallbackSection = sections.get("unassigned") ?? {
      environment: null,
      hosts: [],
    };
    fallbackSection.hosts.push(host);
    sections.set("unassigned", fallbackSection);
  });

  return Array.from(sections.values()).filter((section) => section.hosts.length || section.environment);
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
  environments: HostEnvironmentRecord[];
  createHost: (values: HostFormValues) => string;
  updateHost: (hostId: string, values: HostFormValues) => string;
  deleteHost: (hostId: string) => void;
  toggleFavorite: (hostId: string) => void;
  markConnected: (hostId: string) => void;
  setSnippetCounts: (counts: Record<string, number>) => void;
  assignKey: (hostId: string, key: { label: string; privateKeyPath: string }) => void;
  clearKeyByPath: (privateKeyPath: string) => void;
  createEnvironment: (values: HostEnvironmentFormValues) => string;
  updateEnvironment: (environmentId: string, values: HostEnvironmentFormValues) => string;
  deleteEnvironment: (environmentId: string) => void;
  importHostsFromSshConfig: (configText: string, environmentId?: string) => {
    importedCount: number;
    environmentId: string;
  };
}

export const useHostsStore = create<HostsState>()(
  persist(
    (set) => ({
      environments: sampleEnvironments,
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
      createEnvironment: (values) => {
        const environment = createEnvironmentRecord(values);
        set((state) => ({
          environments: sortEnvironmentCollection([...state.environments, environment]),
        }));
        return environment.id;
      },
      updateEnvironment: (environmentId, values) => {
        set((state) => ({
          environments: sortEnvironmentCollection(
            state.environments.map((environment) =>
              environment.id === environmentId
                ? createEnvironmentRecord(values, environment)
                : environment
            )
          ),
        }));
        return environmentId;
      },
      deleteEnvironment: (environmentId) =>
        set((state) => ({
          environments: sortEnvironmentCollection(
            state.environments.filter((environment) => environment.id !== environmentId)
          ),
          hosts: sortHostCollection(
            state.hosts.map((host) =>
              host.environmentId === environmentId
                ? { ...host, environmentId: undefined, updatedAt: new Date().toISOString() }
                : host
            )
          ),
        })),
      importHostsFromSshConfig: (configText, environmentId) => {
        const importedHosts = parseSshConfig(configText);
        let importedCount = 0;
        let assignedEnvironmentId = environmentId;

        set((state) => {
          let environments = [...state.environments];
          if (!assignedEnvironmentId || !environments.some((entry) => entry.id === assignedEnvironmentId)) {
            const nextEnvironment = createEnvironmentRecord({
              label: "SSH Config Import",
              kind: "custom",
              description: "Hosts bootstrapped from ~/.ssh/config.",
            });
            environments = sortEnvironmentCollection([...environments, nextEnvironment]);
            assignedEnvironmentId = nextEnvironment.id;
          }

          const existingHostsById = new Map(state.hosts.map((host) => [host.id, host]));
          const nextHosts = [...state.hosts];

          importedHosts.forEach((entry) => {
            const hostId = `ssh-config-${entry.alias.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
            const existingHost = existingHostsById.get(hostId);
            const now = new Date().toISOString();
            const nextHost: HostRecord = normalizeHostRecord({
              id: hostId,
              label: entry.alias,
              protocol: "ssh",
              hostname: entry.hostname,
              username: entry.username || "root",
              port: entry.port,
              authMethod: entry.privateKeyPath ? "privateKey" : "none",
              privateKeyPath: entry.privateKeyPath,
              environmentId: assignedEnvironmentId,
              group: existingHost?.group ?? "",
              tags: Array.from(
                new Set([
                  ...(existingHost?.tags ?? []),
                  "imported",
                  ...(entry.jumpHostAlias ? ["jump-host"] : []),
                ])
              ),
              note:
                existingHost?.note ||
                `Imported from ~/.ssh/config${entry.jumpHostAlias ? ` via ${entry.jumpHostAlias}` : ""}.`,
              favorite: existingHost?.favorite ?? false,
              keyLabel: existingHost?.keyLabel ?? "",
              hostKeyPolicy: existingHost?.hostKeyPolicy ?? defaultHostKeyPolicy,
              agentForwarding: existingHost?.agentForwarding ?? false,
              environment: existingHost?.environment ?? {},
              jumpHostId:
                entry.jumpHostAlias
                  ? `ssh-config-${entry.jumpHostAlias.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
                  : existingHost?.jumpHostId,
              sftpRoot: existingHost?.sftpRoot ?? "/home",
              snippetCount: existingHost?.snippetCount ?? 0,
              forwardingCount: existingHost?.forwardingCount ?? 0,
              createdAt: existingHost?.createdAt ?? now,
              updatedAt: now,
              lastConnectedAt: existingHost?.lastConnectedAt,
            });

            const existingIndex = nextHosts.findIndex((host) => host.id === hostId);
            if (existingIndex >= 0) {
              nextHosts[existingIndex] = nextHost;
            } else {
              nextHosts.push(nextHost);
            }
            importedCount += 1;
          });

          return {
            environments,
            hosts: sortHostCollection(nextHosts),
          };
        });

        return {
          importedCount,
          environmentId: assignedEnvironmentId ?? "",
        };
      },
    }),
    {
      name: "termsnip-hosts",
      version: 3,
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? fallbackStorage : window.localStorage
      ),
      migrate: (persistedState) => {
        const state = persistedState as Partial<HostsState> | undefined;
        const ensured = ensureEnvironmentState(
          state?.hosts ?? sampleHosts,
          state?.environments ?? sampleEnvironments
        );

        return {
          ...state,
          environments: ensured.environments,
          hosts: ensured.hosts,
        };
      },
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<HostsState> | undefined;
        const ensured = ensureEnvironmentState(
          persisted?.hosts ?? currentState.hosts,
          persisted?.environments ?? currentState.environments
        );

        return {
          ...currentState,
          ...persisted,
          environments: ensured.environments,
          hosts: ensured.hosts,
        };
      },
    }
  )
);

