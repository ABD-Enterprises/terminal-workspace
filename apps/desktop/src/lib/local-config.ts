import { sortHostCollection, useHostsStore } from "../store/hosts-store";
import { useAppStore } from "../store/app-store";
import { useIdentitiesStore } from "../store/identities-store";
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
import type { IdentityRecord } from "../types/identity";
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
  version: 4;
  exportedAt: string;
  vault: LocalVaultMetadata;
  hosts: HostRecord[];
  keys: KeyRecord[];
  snippets: SnippetRecord[];
  knownHosts: KnownHostRecord[];
  /**
   * M13 (#95): reusable identities now travel in the bundle so a
   * cross-machine export → import preserves the host↔identity bindings.
   * Older bundles (v1–v3) have no identities array; they import as [].
   */
  identities: IdentityRecord[];
  deletions: VaultDeletionMap;
}

/** The pre-#95 bundle shape — vault + deletions, no identity records. */
interface Version3LocalConfigBundle {
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
  identityCount: number;
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
  bundle: ImportedLocalConfigBundle;
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
  identities: LocalConfigMergeSection;
}

interface PreparedLocalConfigCollections {
  hosts: HostRecord[];
  keys: KeyRecord[];
  snippets: SnippetRecord[];
  knownHosts: KnownHostRecord[];
  identities: IdentityRecord[];
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

type ImportedLocalConfigBundle =
  | LocalConfigBundle
  | Version3LocalConfigBundle
  | Version2LocalConfigBundle
  | LegacyLocalConfigBundle;

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

function sortIdentities(identities: IdentityRecord[]) {
  return [...identities].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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

function isIdentityArray(value: unknown): value is IdentityRecord[] {
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
  // M13 (#95): identity records only exist in v4+ bundles. Older bundles
  // import as an empty set — the identities store's own migration still
  // re-derives identities from the imported hosts, so nothing is lost
  // beyond user-edited labels (which is exactly what v4 now preserves).
  const importedIdentities =
    importedBundle.version === 4 && isIdentityArray(importedBundle.identities)
      ? sortIdentities(importedBundle.identities)
      : [];

  return {
    hosts: importedHosts,
    keys: importedKeys,
    snippets: importedSnippets,
    knownHosts: importedKnownHosts,
    identities: importedIdentities,
  };
}

function prepareImportedDeletions(
  importedBundle: ImportedLocalConfigBundle
): PreparedLocalConfigDeletions {
  if (
    (importedBundle.version !== 3 && importedBundle.version !== 4) ||
    !("deletions" in importedBundle)
  ) {
    return normalizeDeletions();
  }

  return normalizeDeletions(importedBundle.deletions);
}

function getImportedVaultMetadata(importedBundle: ImportedLocalConfigBundle): LocalVaultMetadata | null {
  if (
    (importedBundle.version === 2 ||
      importedBundle.version === 3 ||
      importedBundle.version === 4) &&
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
  const survivingIdentityIds = new Set(appliedCollections.identities.map((record) => record.id));

  return {
    hosts: mergeDeletionEntries(localDeletions.hosts, importedDeletions.hosts, survivingHostIds),
    keys: mergeDeletionEntries(localDeletions.keys, importedDeletions.keys, survivingKeyIds),
    snippets: mergeDeletionEntries(localDeletions.snippets, importedDeletions.snippets, survivingSnippetIds),
    knownHosts: mergeDeletionEntries(
      localDeletions.knownHosts,
      importedDeletions.knownHosts,
      survivingKnownHostIds
    ),
    // M13 (#95): identities now ship in the v4 bundle and have a real
    // applied collection, so a deletion is only retained when the id
    // didn't survive the merge — same surviving-id filter as every
    // other collection.
    identities: mergeDeletionEntries(
      localDeletions.identities,
      importedDeletions.identities,
      survivingIdentityIds
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
  const mergedIdentities = mergeCollection(
    localCollections.identities,
    importedCollections.identities,
    sortIdentities,
    importedDeletions.identities
  );
  const hasConflicts =
    mergedHosts.section.conflicts > 0 ||
    mergedKeys.section.conflicts > 0 ||
    mergedSnippets.section.conflicts > 0 ||
    mergedKnownHosts.section.conflicts > 0 ||
    mergedIdentities.section.conflicts > 0;

  return {
    applicable: true,
    hasConflicts,
    hosts: mergedHosts.section,
    keys: mergedKeys.section,
    snippets: mergedSnippets.section,
    knownHosts: mergedKnownHosts.section,
    identities: mergedIdentities.section,
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
  const mergedIdentities = mergeCollection(
    localCollections.identities,
    importedCollections.identities,
    sortIdentities,
    importedDeletions.identities,
    conflictResolution
  );

  return {
    hosts: mergedHosts,
    keys: mergedKeys,
    snippets: mergedSnippets,
    knownHosts: mergedKnownHosts,
    identities: mergedIdentities,
  };
}

export function buildLocalConfigBundle(): LocalConfigBundle {
  const appState = useAppStore.getState();

  // M13 (#95): the v4 bundle carries reusable identity records so a
  // cross-machine export → import preserves user-edited identity labels
  // and the host↔identity bindings. Prior versions relied on the
  // identities-store migration re-deriving identities from hosts, which
  // lost any manual edits. Older bundles still import cleanly (identities
  // default to []).
  //
  // KeyRecord.comment IS preserved through export/import — it's a field on
  // the type that the keys array carries verbatim (M14 / #96 needs no
  // separate handling).
  return {
    app: "TermSnip",
    version: 4,
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
    identities: useIdentitiesStore.getState().identities,
    deletions: compactDeletionMap(useVaultSyncStore.getState().deletions),
  };
}

function parseImportedLocalConfigBundle(bundle: unknown): PreparedLocalConfigImport {
  if (!isRecord(bundle)) {
    throw new Error("Config import failed: file does not contain a JSON object.");
  }

  if (
    bundle.app !== "TermSnip" ||
    (bundle.version !== 1 &&
      bundle.version !== 2 &&
      bundle.version !== 3 &&
      bundle.version !== 4)
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

  // v4 introduced the identities collection. When present it must be an
  // array; when absent (v1–v3) it imports as empty. We don't hard-fail a
  // v4 bundle that omits the field — treat it as [] for resilience.
  if (bundle.version === 4 && "identities" in bundle && !isIdentityArray(bundle.identities)) {
    throw new Error("Config import failed: identities are invalid.");
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
      identityCount: importedCollections.identities.length,
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
                identities: useIdentitiesStore.getState().identities,
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
    identities: useIdentitiesStore.getState().identities,
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
      mergedCollections.knownHosts.section.conflicts > 0 ||
      mergedCollections.identities.section.conflicts > 0);

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
  const appliedIdentities =
    mode === "merge" ? mergedCollections?.identities.records ?? [] : importedCollections.identities;
  const nextDeletions = buildAppliedDeletionMap(mode, importedDeletions, {
    hosts: appliedHosts,
    keys: appliedKeys,
    snippets: appliedSnippets,
    knownHosts: appliedKnownHosts,
    identities: appliedIdentities,
  });

  useHostsStore.setState((state) => ({ ...state, hosts: appliedHosts }));
  useKeysStore.setState((state) => ({ ...state, keys: appliedKeys }));
  useSnippetsStore.setState((state) => ({ ...state, snippets: appliedSnippets }));
  useKnownHostsStore.setState((state) => ({ ...state, knownHosts: appliedKnownHosts }));
  useIdentitiesStore.setState((state) => ({ ...state, identities: appliedIdentities }));
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
    identityCount: appliedIdentities.length,
    importStrategy: preparedImport.analysis.strategy,
    mode,
    mergePlan: preparedImport.analysis.mergePlan,
    conflictResolution: mode === "merge" ? (hasMergeConflicts ? conflictResolution : null) : null,
    snapshotId: importedVault?.snapshotId ?? null,
    vaultId: importedVault?.vaultId ?? useAppStore.getState().vaultId,
  };
}
