import { sortHostCollection, useHostsStore } from "../store/hosts-store";
import { useAppStore } from "../store/app-store";
import { useKeysStore } from "../store/keys-store";
import { useKnownHostsStore } from "../store/known-hosts-store";
import { useSessionsStore } from "../store/sessions-store";
import { useSnippetsStore } from "../store/snippets-store";
import { useTransfersStore } from "../store/transfers-store";
import type { HostRecord } from "../types/host";
import type { KeyRecord } from "../types/key";
import type { KnownHostRecord } from "../types/known-host";
import type { SnippetRecord } from "../types/snippet";

export interface LocalVaultMetadata {
  schema: "local-first-vault";
  vaultId: string;
  sourceDeviceId: string;
  snapshotId: string;
  baseSnapshotId: string | null;
}

export interface LocalConfigBundle {
  app: "TermSnip";
  version: 2;
  exportedAt: string;
  vault: LocalVaultMetadata;
  hosts: HostRecord[];
  keys: KeyRecord[];
  snippets: SnippetRecord[];
  knownHosts: KnownHostRecord[];
}

interface LegacyLocalConfigBundle {
  app: "TermSnip";
  version: 1;
  exportedAt: string;
  hosts: HostRecord[];
  keys: KeyRecord[];
  snippets: SnippetRecord[];
  knownHosts: KnownHostRecord[];
}

export type LocalConfigImportStrategy =
  | "legacy"
  | "same_snapshot"
  | "fast_forward"
  | "divergent"
  | "adopt_vault";

export interface LocalConfigImportAnalysis {
  strategy: LocalConfigImportStrategy;
  hostCount: number;
  keyCount: number;
  snippetCount: number;
  knownHostCount: number;
  currentVaultId: string;
  currentDeviceId: string;
  currentSnapshotId: string | null;
  importedVaultId: string | null;
  importedDeviceId: string | null;
  importedSnapshotId: string | null;
  importedBaseSnapshotId: string | null;
  mergePlan: LocalConfigMergePlan | null;
}

export interface PreparedLocalConfigImport {
  bundle: LocalConfigBundle | LegacyLocalConfigBundle;
  analysis: LocalConfigImportAnalysis;
}

export interface LocalConfigMergeSection {
  added: number;
  updated: number;
  retainedLocal: number;
  unchanged: number;
  conflicts: number;
  conflictingIds: string[];
}

export interface LocalConfigMergePlan {
  applicable: boolean;
  hasConflicts: boolean;
  hosts: LocalConfigMergeSection;
  keys: LocalConfigMergeSection;
  snippets: LocalConfigMergeSection;
  knownHosts: LocalConfigMergeSection;
}

interface PreparedLocalConfigCollections {
  hosts: HostRecord[];
  keys: KeyRecord[];
  snippets: SnippetRecord[];
  knownHosts: KnownHostRecord[];
}

interface MergeResult<T> {
  records: T[];
  section: LocalConfigMergeSection;
}

export interface ApplyLocalConfigOptions {
  mode?: "replace" | "merge";
  conflictResolution?: "keep-local" | "prefer-imported";
}

function sortKeys(keys: KeyRecord[]) {
  return [...keys].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function sortSnippets(snippets: SnippetRecord[]) {
  return [...snippets].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function sortKnownHosts(knownHosts: KnownHostRecord[]) {
  return [...knownHosts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function createEmptyMergeSection(): LocalConfigMergeSection {
  return {
    added: 0,
    updated: 0,
    retainedLocal: 0,
    unchanged: 0,
    conflicts: 0,
    conflictingIds: [],
  };
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHostArray(value: unknown): value is HostRecord[] {
  return Array.isArray(value);
}

function isKeyArray(value: unknown): value is KeyRecord[] {
  return Array.isArray(value);
}

function isSnippetArray(value: unknown): value is SnippetRecord[] {
  return Array.isArray(value);
}

function isKnownHostArray(value: unknown): value is KnownHostRecord[] {
  return Array.isArray(value);
}

function prepareImportedCollections(
  importedBundle: LocalConfigBundle | LegacyLocalConfigBundle,
  hostIds?: Set<string>
): PreparedLocalConfigCollections {
  const importedHosts = sortHostCollection(importedBundle.hosts);
  const importedHostIds = hostIds ?? new Set(importedHosts.map((host) => host.id));
  const importedKeys = sortKeys(
    importedBundle.keys.map((key) => ({
      ...key,
      assignedHostIds: key.assignedHostIds.filter((hostId) => importedHostIds.has(hostId)),
    }))
  );
  const importedSnippets = sortSnippets(
    importedBundle.snippets.map((snippet) => ({
      ...snippet,
      targetHostIds: snippet.targetHostIds.filter((hostId) => importedHostIds.has(hostId)),
    }))
  );
  const importedKnownHosts = sortKnownHosts(importedBundle.knownHosts);

  return {
    hosts: importedHosts,
    keys: importedKeys,
    snippets: importedSnippets,
    knownHosts: importedKnownHosts,
  };
}

function mergeCollection<T extends { id: string; updatedAt: string }>(
  localRecords: T[],
  importedRecords: T[],
  sortRecords: (records: T[]) => T[],
  conflictResolution: "block" | "keep-local" | "prefer-imported" = "block"
): MergeResult<T> {
  const section = createEmptyMergeSection();
  const mergedRecords: T[] = [];
  const localById = new Map(localRecords.map((record) => [record.id, record]));
  const importedById = new Map(importedRecords.map((record) => [record.id, record]));
  const allIds = new Set([...localById.keys(), ...importedById.keys()]);

  for (const id of allIds) {
    const localRecord = localById.get(id);
    const importedRecord = importedById.get(id);

    if (!localRecord && importedRecord) {
      mergedRecords.push(importedRecord);
      section.added += 1;
      continue;
    }

    if (localRecord && !importedRecord) {
      mergedRecords.push(localRecord);
      section.retainedLocal += 1;
      continue;
    }

    if (!localRecord || !importedRecord) {
      continue;
    }

    if (stableSerialize(localRecord) === stableSerialize(importedRecord)) {
      mergedRecords.push(localRecord);
      section.unchanged += 1;
      continue;
    }

    if (importedRecord.updatedAt > localRecord.updatedAt) {
      mergedRecords.push(importedRecord);
      section.updated += 1;
      continue;
    }

    if (importedRecord.updatedAt < localRecord.updatedAt) {
      mergedRecords.push(localRecord);
      section.retainedLocal += 1;
      continue;
    }

    section.conflicts += 1;
    section.conflictingIds.push(id);

    if (conflictResolution === "prefer-imported") {
      mergedRecords.push(importedRecord);
      continue;
    }

    mergedRecords.push(localRecord);
  }

  return {
    records: sortRecords(mergedRecords),
    section,
  };
}

function buildMergePlan(
  localCollections: PreparedLocalConfigCollections,
  importedCollections: PreparedLocalConfigCollections
): LocalConfigMergePlan {
  const mergedHosts = mergeCollection(localCollections.hosts, importedCollections.hosts, sortHostCollection);
  const mergedHostIds = new Set(mergedHosts.records.map((host) => host.id));
  const normalizedLocalKeys = sortKeys(
    localCollections.keys.map((key) => ({
      ...key,
      assignedHostIds: key.assignedHostIds.filter((hostId) => mergedHostIds.has(hostId)),
    }))
  );
  const normalizedImportedKeys = sortKeys(
    importedCollections.keys.map((key) => ({
      ...key,
      assignedHostIds: key.assignedHostIds.filter((hostId) => mergedHostIds.has(hostId)),
    }))
  );
  const normalizedLocalSnippets = sortSnippets(
    localCollections.snippets.map((snippet) => ({
      ...snippet,
      targetHostIds: snippet.targetHostIds.filter((hostId) => mergedHostIds.has(hostId)),
    }))
  );
  const normalizedImportedSnippets = sortSnippets(
    importedCollections.snippets.map((snippet) => ({
      ...snippet,
      targetHostIds: snippet.targetHostIds.filter((hostId) => mergedHostIds.has(hostId)),
    }))
  );
  const mergedKeys = mergeCollection(normalizedLocalKeys, normalizedImportedKeys, sortKeys);
  const mergedSnippets = mergeCollection(normalizedLocalSnippets, normalizedImportedSnippets, sortSnippets);
  const mergedKnownHosts = mergeCollection(
    localCollections.knownHosts,
    importedCollections.knownHosts,
    sortKnownHosts
  );
  const hasConflicts =
    mergedHosts.section.conflicts > 0 ||
    mergedKeys.section.conflicts > 0 ||
    mergedSnippets.section.conflicts > 0 ||
    mergedKnownHosts.section.conflicts > 0;

  return {
    applicable: true,
    hasConflicts,
    hosts: mergedHosts.section,
    keys: mergedKeys.section,
    snippets: mergedSnippets.section,
    knownHosts: mergedKnownHosts.section,
  };
}

function mergePreparedCollections(
  localCollections: PreparedLocalConfigCollections,
  importedCollections: PreparedLocalConfigCollections,
  conflictResolution: "block" | "keep-local" | "prefer-imported" = "block"
) {
  const mergedHosts = mergeCollection(
    localCollections.hosts,
    importedCollections.hosts,
    sortHostCollection,
    conflictResolution
  );
  const mergedHostIds = new Set(mergedHosts.records.map((host) => host.id));
  const mergedKeys = mergeCollection(
    sortKeys(
      localCollections.keys.map((key) => ({
        ...key,
        assignedHostIds: key.assignedHostIds.filter((hostId) => mergedHostIds.has(hostId)),
      }))
    ),
    sortKeys(
      importedCollections.keys.map((key) => ({
        ...key,
        assignedHostIds: key.assignedHostIds.filter((hostId) => mergedHostIds.has(hostId)),
      }))
    ),
    sortKeys,
    conflictResolution
  );
  const mergedSnippets = mergeCollection(
    sortSnippets(
      localCollections.snippets.map((snippet) => ({
        ...snippet,
        targetHostIds: snippet.targetHostIds.filter((hostId) => mergedHostIds.has(hostId)),
      }))
    ),
    sortSnippets(
      importedCollections.snippets.map((snippet) => ({
        ...snippet,
        targetHostIds: snippet.targetHostIds.filter((hostId) => mergedHostIds.has(hostId)),
      }))
    ),
    sortSnippets,
    conflictResolution
  );
  const mergedKnownHosts = mergeCollection(
    localCollections.knownHosts,
    importedCollections.knownHosts,
    sortKnownHosts,
    conflictResolution
  );

  return {
    hosts: mergedHosts,
    keys: mergedKeys,
    snippets: mergedSnippets,
    knownHosts: mergedKnownHosts,
  };
}

export function buildLocalConfigBundle(): LocalConfigBundle {
  const appState = useAppStore.getState();

  return {
    app: "TermSnip",
    version: 2,
    exportedAt: new Date().toISOString(),
    vault: {
      schema: "local-first-vault",
      vaultId: appState.vaultId,
      sourceDeviceId: appState.deviceId,
      snapshotId: crypto.randomUUID(),
      baseSnapshotId: appState.lastAppliedSnapshotId,
    },
    hosts: useHostsStore.getState().hosts,
    keys: useKeysStore.getState().keys,
    snippets: useSnippetsStore.getState().snippets,
    knownHosts: useKnownHostsStore.getState().knownHosts,
  };
}

function parseImportedLocalConfigBundle(bundle: unknown): PreparedLocalConfigImport {
  if (!isRecord(bundle)) {
    throw new Error("Config import failed: file does not contain a JSON object.");
  }

  if (
    bundle.app !== "TermSnip" ||
    (bundle.version !== 1 && bundle.version !== 2)
  ) {
    throw new Error("Config import failed: unsupported TermSnip config version.");
  }

  if (!isHostArray(bundle.hosts)) {
    throw new Error("Config import failed: hosts are missing or invalid.");
  }

  if (!isKeyArray(bundle.keys)) {
    throw new Error("Config import failed: keys are missing or invalid.");
  }

  if (!isSnippetArray(bundle.snippets)) {
    throw new Error("Config import failed: snippets are missing or invalid.");
  }

  if (!isKnownHostArray(bundle.knownHosts)) {
    throw new Error("Config import failed: known hosts are missing or invalid.");
  }

  const importedBundle = bundle as unknown as LocalConfigBundle | LegacyLocalConfigBundle;
  const appState = useAppStore.getState();
  const importedCollections = prepareImportedCollections(importedBundle);
  const importedVault =
    importedBundle.version === 2 && importedBundle.vault?.schema === "local-first-vault"
      ? importedBundle.vault
      : null;
  let strategy: LocalConfigImportStrategy = "legacy";

  if (importedVault) {
    if (importedVault.snapshotId === appState.lastAppliedSnapshotId) {
      strategy = "same_snapshot";
    } else if (importedVault.vaultId !== appState.vaultId) {
      strategy = "adopt_vault";
    } else if (
      appState.lastAppliedSnapshotId &&
      importedVault.baseSnapshotId === appState.lastAppliedSnapshotId
    ) {
      strategy = "fast_forward";
    } else {
      strategy = "divergent";
    }
  }

  return {
    bundle: importedBundle,
    analysis: {
      strategy,
      hostCount: importedCollections.hosts.length,
      keyCount: importedCollections.keys.length,
      snippetCount: importedCollections.snippets.length,
      knownHostCount: importedCollections.knownHosts.length,
      currentVaultId: appState.vaultId,
      currentDeviceId: appState.deviceId,
      currentSnapshotId: appState.lastAppliedSnapshotId,
      importedVaultId: importedVault?.vaultId ?? null,
      importedDeviceId: importedVault?.sourceDeviceId ?? null,
      importedSnapshotId: importedVault?.snapshotId ?? null,
      importedBaseSnapshotId: importedVault?.baseSnapshotId ?? null,
      mergePlan:
        importedVault && importedVault.vaultId === appState.vaultId
          ? buildMergePlan(
              {
                hosts: useHostsStore.getState().hosts,
                keys: useKeysStore.getState().keys,
                snippets: useSnippetsStore.getState().snippets,
                knownHosts: useKnownHostsStore.getState().knownHosts,
              },
              importedCollections
            )
          : null,
    },
  };
}

export function inspectImportedLocalConfigBundle(bundle: unknown): LocalConfigImportAnalysis {
  return parseImportedLocalConfigBundle(bundle).analysis;
}

function isPreparedLocalConfigImport(value: unknown): value is PreparedLocalConfigImport {
  return isRecord(value) && "bundle" in value && "analysis" in value;
}

export function applyImportedLocalConfigBundle(bundle: unknown, options: ApplyLocalConfigOptions = {}) {
  const preparedImport = isPreparedLocalConfigImport(bundle)
    ? bundle
    : parseImportedLocalConfigBundle(bundle);
  const importedBundle = preparedImport.bundle;
  const mode = options.mode ?? "replace";
  const conflictResolution = options.conflictResolution ?? "keep-local";
  const currentCollections: PreparedLocalConfigCollections = {
    hosts: useHostsStore.getState().hosts,
    keys: useKeysStore.getState().keys,
    snippets: useSnippetsStore.getState().snippets,
    knownHosts: useKnownHostsStore.getState().knownHosts,
  };
  const importedCollections = prepareImportedCollections(importedBundle);
  const mergedCollections =
    mode === "merge"
      ? mergePreparedCollections(
          currentCollections,
          importedCollections,
          options.conflictResolution ? conflictResolution : "block"
        )
      : null;
  const hasMergeConflicts =
    mergedCollections &&
    (mergedCollections.hosts.section.conflicts > 0 ||
      mergedCollections.keys.section.conflicts > 0 ||
      mergedCollections.snippets.section.conflicts > 0 ||
      mergedCollections.knownHosts.section.conflicts > 0);

  if (mode === "merge" && preparedImport.analysis.strategy !== "fast_forward" && preparedImport.analysis.strategy !== "divergent" && preparedImport.analysis.strategy !== "same_snapshot") {
    throw new Error("Config import merge is only available for imports from the current vault lineage.");
  }

  if (mode === "merge" && hasMergeConflicts && !options.conflictResolution) {
    throw new Error("Config import merge found record conflicts. Review the import preview and replace the local vault only if that overwrite is intentional.");
  }

  const appliedHosts = mode === "merge" ? mergedCollections?.hosts.records ?? [] : importedCollections.hosts;
  const appliedKeys = mode === "merge" ? mergedCollections?.keys.records ?? [] : importedCollections.keys;
  const appliedSnippets =
    mode === "merge" ? mergedCollections?.snippets.records ?? [] : importedCollections.snippets;
  const appliedKnownHosts =
    mode === "merge" ? mergedCollections?.knownHosts.records ?? [] : importedCollections.knownHosts;

  useHostsStore.setState((state) => ({ ...state, hosts: appliedHosts }));
  useKeysStore.setState((state) => ({ ...state, keys: appliedKeys }));
  useSnippetsStore.setState((state) => ({ ...state, snippets: appliedSnippets }));
  useKnownHostsStore.setState((state) => ({ ...state, knownHosts: appliedKnownHosts }));
  if (
    importedBundle.version === 2 &&
    importedBundle.vault?.schema === "local-first-vault" &&
    importedBundle.vault.vaultId
  ) {
    useAppStore.getState().setVaultId(importedBundle.vault.vaultId);
    useAppStore.getState().setLastAppliedSnapshotId(importedBundle.vault.snapshotId);
  } else {
    useAppStore.getState().setLastAppliedSnapshotId(null);
  }
  const nextActiveHostId =
    useTransfersStore.getState().activeHostId &&
    appliedHosts.some((host) => host.id === useTransfersStore.getState().activeHostId)
      ? useTransfersStore.getState().activeHostId
      : appliedHosts[0]?.id;
  useSessionsStore.setState((state) => ({
    ...state,
    tabs: [],
    panes: {},
    activeTabId: undefined,
    lastRestoredAt: new Date().toISOString(),
  }));
  useTransfersStore.setState((state) => ({
    ...state,
    activeHostId: nextActiveHostId,
    remotePathByHost: {},
    queue: [],
  }));

  return {
    hostCount: appliedHosts.length,
    keyCount: appliedKeys.length,
    snippetCount: appliedSnippets.length,
    knownHostCount: appliedKnownHosts.length,
    importStrategy: preparedImport.analysis.strategy,
    mode,
    mergePlan: preparedImport.analysis.mergePlan,
    conflictResolution: mode === "merge" ? (hasMergeConflicts ? conflictResolution : null) : null,
    snapshotId:
      importedBundle.version === 2 && importedBundle.vault?.snapshotId
        ? importedBundle.vault.snapshotId
        : null,
    vaultId:
      importedBundle.version === 2 && importedBundle.vault?.vaultId
        ? importedBundle.vault.vaultId
        : useAppStore.getState().vaultId,
  };
}
