import { sortHostCollection, useHostsStore } from "../store/hosts-store";
import { useAppStore } from "../store/app-store";
import { useKeysStore } from "../store/keys-store";
import { useKnownHostsStore } from "../store/known-hosts-store";
import { useSessionsStore } from "../store/sessions-store";
import { useSnippetsStore } from "../store/snippets-store";
import { useTransfersStore } from "../store/transfers-store";
import {
  compactDeletionMap,
  useVaultSyncStore,
  type VaultDeletionEntry,
  type VaultDeletionMap,
} from "../store/vault-sync-store";
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
  version: 3;
  exportedAt: string;
  vault: LocalVaultMetadata;
  hosts: HostRecord[];
  keys: KeyRecord[];
  snippets: SnippetRecord[];
  knownHosts: KnownHostRecord[];
  deletions: VaultDeletionMap;
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

interface Version2LocalConfigBundle {
  app: "TermSnip";
  version: 2;
  exportedAt: string;
  vault: LocalVaultMetadata;
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
  bundle: LocalConfigBundle | Version2LocalConfigBundle | LegacyLocalConfigBundle;
  analysis: LocalConfigImportAnalysis;
}

export interface LocalConfigMergeSection {
  added: number;
  updated: number;
  removed: number;
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

interface PreparedLocalConfigDeletions {
  hosts: VaultDeletionEntry[];
  keys: VaultDeletionEntry[];
  snippets: VaultDeletionEntry[];
  knownHosts: VaultDeletionEntry[];
  /** P2-DM1: identity tombstones. Defaults to [] when an older bundle
   *  without this collection is imported. */
  identities: VaultDeletionEntry[];
}

interface MergeResult<T> {
  records: T[];
  section: LocalConfigMergeSection;
}

type ImportedLocalConfigBundle = LocalConfigBundle | Version2LocalConfigBundle | LegacyLocalConfigBundle;

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
    removed: 0,
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

function isDeletionArray(value: unknown): value is VaultDeletionEntry[] {
  return Array.isArray(value);
}

function normalizeDeletions(deletions?: Partial<VaultDeletionMap> | null): PreparedLocalConfigDeletions {
  const compacted = compactDeletionMap({
    hosts: isDeletionArray(deletions?.hosts)
      ? deletions.hosts.filter(
          (entry): entry is VaultDeletionEntry =>
            isRecord(entry) &&
            typeof entry.id === "string" &&
            typeof entry.deletedAt === "string"
        )
      : [],
    keys: isDeletionArray(deletions?.keys)
      ? deletions.keys.filter(
          (entry): entry is VaultDeletionEntry =>
            isRecord(entry) &&
            typeof entry.id === "string" &&
            typeof entry.deletedAt === "string"
        )
      : [],
    snippets: isDeletionArray(deletions?.snippets)
      ? deletions.snippets.filter(
          (entry): entry is VaultDeletionEntry =>
            isRecord(entry) &&
            typeof entry.id === "string" &&
            typeof entry.deletedAt === "string"
        )
      : [],
    knownHosts: isDeletionArray(deletions?.knownHosts)
      ? deletions.knownHosts.filter(
          (entry): entry is VaultDeletionEntry =>
            isRecord(entry) &&
            typeof entry.id === "string" &&
            typeof entry.deletedAt === "string"
        )
      : [],
    identities: isDeletionArray(deletions?.identities)
      ? deletions.identities.filter(
          (entry): entry is VaultDeletionEntry =>
            isRecord(entry) &&
            typeof entry.id === "string" &&
            typeof entry.deletedAt === "string"
        )
      : [],
  });

  return {
    hosts: compacted.hosts,
    keys: compacted.keys,
    snippets: compacted.snippets,
    knownHosts: compacted.knownHosts,
    identities: compacted.identities,
  };
}

function prepareImportedCollections(
  importedBundle: ImportedLocalConfigBundle,
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

function prepareImportedDeletions(
  importedBundle: ImportedLocalConfigBundle
): PreparedLocalConfigDeletions {
  if (importedBundle.version !== 3 || !("deletions" in importedBundle)) {
    return normalizeDeletions();
  }

  return normalizeDeletions(importedBundle.deletions);
}

function getImportedVaultMetadata(importedBundle: ImportedLocalConfigBundle): LocalVaultMetadata | null {
  if (
    (importedBundle.version === 2 || importedBundle.version === 3) &&
    importedBundle.vault?.schema === "local-first-vault"
  ) {
    return importedBundle.vault;
  }

  return null;
}

function mergeDeletionEntries(
  localEntries: VaultDeletionEntry[],
  importedEntries: VaultDeletionEntry[],
  survivingIds: Set<string>
) {
  const mergedById = new Map<string, VaultDeletionEntry>();

  for (const entry of [...localEntries, ...importedEntries]) {
    if (survivingIds.has(entry.id)) {
      continue;
    }

    const existing = mergedById.get(entry.id);
    if (!existing || entry.deletedAt > existing.deletedAt) {
      mergedById.set(entry.id, entry);
    }
  }

  return [...mergedById.values()].sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));
}

function buildAppliedDeletionMap(
  mode: "replace" | "merge",
  importedDeletions: PreparedLocalConfigDeletions,
  appliedCollections: PreparedLocalConfigCollections
): VaultDeletionMap {
  if (mode === "replace") {
    return importedDeletions;
  }

  const localDeletions = useVaultSyncStore.getState().deletions;
  const survivingHostIds = new Set(appliedCollections.hosts.map((record) => record.id));
  const survivingKeyIds = new Set(appliedCollections.keys.map((record) => record.id));
  const survivingSnippetIds = new Set(appliedCollections.snippets.map((record) => record.id));
  const survivingKnownHostIds = new Set(appliedCollections.knownHosts.map((record) => record.id));

  return {
    hosts: mergeDeletionEntries(localDeletions.hosts, importedDeletions.hosts, survivingHostIds),
    keys: mergeDeletionEntries(localDeletions.keys, importedDeletions.keys, survivingKeyIds),
    snippets: mergeDeletionEntries(localDeletions.snippets, importedDeletions.snippets, survivingSnippetIds),
    knownHosts: mergeDeletionEntries(
      localDeletions.knownHosts,
      importedDeletions.knownHosts,
      survivingKnownHostIds
    ),
    // P2-DM1 batch 1: identities are not yet shipped in the bundle, but the
    // map shape requires the field. Defer all local entries unconditionally
    // (no surviving-id filter — identities don't yet have a corresponding
    // applied collection in this bundle version).
    identities: mergeDeletionEntries(
      localDeletions.identities,
      importedDeletions.identities,
      new Set<string>()
    ),
  };
}

function mergeCollection<T extends { id: string; updatedAt: string }>(
  localRecords: T[],
  importedRecords: T[],
  sortRecords: (records: T[]) => T[],
  deletions: VaultDeletionEntry[] = [],
  conflictResolution: "block" | "keep-local" | "prefer-imported" = "block"
): MergeResult<T> {
  const section = createEmptyMergeSection();
  const mergedRecords: T[] = [];
  const localById = new Map(localRecords.map((record) => [record.id, record]));
  const importedById = new Map(importedRecords.map((record) => [record.id, record]));
  const deletionById = new Map(deletions.map((entry) => [entry.id, entry]));
  const allIds = new Set([...localById.keys(), ...importedById.keys()]);

  for (const id of allIds) {
    const localRecord = localById.get(id);
    const importedRecord = importedById.get(id);
    const deletion = deletionById.get(id);

    if (deletion && !importedRecord) {
      if (!localRecord) {
        continue;
      }

      if (localRecord.updatedAt < deletion.deletedAt) {
        section.removed += 1;
        continue;
      }

      if (localRecord.updatedAt > deletion.deletedAt) {
        mergedRecords.push(localRecord);
        section.retainedLocal += 1;
        continue;
      }

      section.conflicts += 1;
      section.conflictingIds.push(id);

      if (conflictResolution === "prefer-imported") {
        section.removed += 1;
        continue;
      }

      mergedRecords.push(localRecord);
      continue;
    }

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
  importedCollections: PreparedLocalConfigCollections,
  importedDeletions: PreparedLocalConfigDeletions
): LocalConfigMergePlan {
  const mergedHosts = mergeCollection(
    localCollections.hosts,
    importedCollections.hosts,
    sortHostCollection,
    importedDeletions.hosts
  );
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
  const mergedKeys = mergeCollection(
    normalizedLocalKeys,
    normalizedImportedKeys,
    sortKeys,
    importedDeletions.keys
  );
  const mergedSnippets = mergeCollection(
    normalizedLocalSnippets,
    normalizedImportedSnippets,
    sortSnippets,
    importedDeletions.snippets
  );
  const mergedKnownHosts = mergeCollection(
    localCollections.knownHosts,
    importedCollections.knownHosts,
    sortKnownHosts,
    importedDeletions.knownHosts
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
  importedDeletions: PreparedLocalConfigDeletions,
  conflictResolution: "block" | "keep-local" | "prefer-imported" = "block"
) {
  const mergedHosts = mergeCollection(
    localCollections.hosts,
    importedCollections.hosts,
    sortHostCollection,
    importedDeletions.hosts,
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
    importedDeletions.keys,
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
    importedDeletions.snippets,
    conflictResolution
  );
  const mergedKnownHosts = mergeCollection(
    localCollections.knownHosts,
    importedCollections.knownHosts,
    sortKnownHosts,
    importedDeletions.knownHosts,
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

  // Note: Identity records (P2-DM1 batch 1) are NOT in the v3 export bundle
  // yet — this is deliberate. The auto-migration in identities-store
  // re-derives identities from hosts on import, so a v3 round-trip still
  // produces an equivalent identity set. User-edited identity labels are
  // not yet preserved across import; full identity collection support
  // lands when bundle version 4 ships with merge-plan semantics for
  // the new collection. See issue #95 (M13).
  //
  // KeyRecord.comment IS preserved through export/import — it's a
  // field on the type that the keys array carries verbatim. The
  // original M14 audit pickup referenced an earlier draft where the
  // field was a separate sidecar; it ships as part of KeyRecord
  // today. No action needed for M14 (#96).
  return {
    app: "TermSnip",
    version: 3,
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
    deletions: compactDeletionMap(useVaultSyncStore.getState().deletions),
  };
}

function parseImportedLocalConfigBundle(bundle: unknown): PreparedLocalConfigImport {
  if (!isRecord(bundle)) {
    throw new Error("Config import failed: file does not contain a JSON object.");
  }

  if (
    bundle.app !== "TermSnip" ||
    (bundle.version !== 1 && bundle.version !== 2 && bundle.version !== 3)
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

  const importedBundle = bundle as unknown as ImportedLocalConfigBundle;
  const appState = useAppStore.getState();
  const importedCollections = prepareImportedCollections(importedBundle);
  const importedDeletions = prepareImportedDeletions(importedBundle);
  const importedVault = getImportedVaultMetadata(importedBundle);
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
              importedCollections,
              importedDeletions
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
  const importedDeletions = prepareImportedDeletions(importedBundle);
  const mergedCollections =
    mode === "merge"
      ? mergePreparedCollections(
          currentCollections,
          importedCollections,
          importedDeletions,
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
  const nextDeletions = buildAppliedDeletionMap(mode, importedDeletions, {
    hosts: appliedHosts,
    keys: appliedKeys,
    snippets: appliedSnippets,
    knownHosts: appliedKnownHosts,
  });

  useHostsStore.setState((state) => ({ ...state, hosts: appliedHosts }));
  useKeysStore.setState((state) => ({ ...state, keys: appliedKeys }));
  useSnippetsStore.setState((state) => ({ ...state, snippets: appliedSnippets }));
  useKnownHostsStore.setState((state) => ({ ...state, knownHosts: appliedKnownHosts }));
  useVaultSyncStore.getState().replaceDeletions(nextDeletions);
  const importedVault = getImportedVaultMetadata(importedBundle);
  if (importedVault?.vaultId) {
    useAppStore.getState().setVaultId(importedVault.vaultId);
    useAppStore.getState().setLastAppliedSnapshotId(importedVault.snapshotId);
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
    snapshotId: importedVault?.snapshotId ?? null,
    vaultId: importedVault?.vaultId ?? useAppStore.getState().vaultId,
  };
}
