import { sortHostCollection, useHostsStore } from "../store/hosts-store";
import { useKeysStore } from "../store/keys-store";
import { useKnownHostsStore } from "../store/known-hosts-store";
import { useSessionsStore } from "../store/sessions-store";
import { useSnippetsStore } from "../store/snippets-store";
import { useTransfersStore } from "../store/transfers-store";
import type { HostRecord } from "../types/host";
import type { KeyRecord } from "../types/key";
import type { KnownHostRecord } from "../types/known-host";
import type { SnippetRecord } from "../types/snippet";

export interface LocalConfigBundle {
  app: "TermSnip";
  version: 1;
  exportedAt: string;
  hosts: HostRecord[];
  keys: KeyRecord[];
  snippets: SnippetRecord[];
  knownHosts: KnownHostRecord[];
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

export function buildLocalConfigBundle(): LocalConfigBundle {
  return {
    app: "TermSnip",
    version: 1,
    exportedAt: new Date().toISOString(),
    hosts: useHostsStore.getState().hosts,
    keys: useKeysStore.getState().keys,
    snippets: useSnippetsStore.getState().snippets,
    knownHosts: useKnownHostsStore.getState().knownHosts,
  };
}

export function applyImportedLocalConfigBundle(bundle: unknown) {
  if (!isRecord(bundle)) {
    throw new Error("Config import failed: file does not contain a JSON object.");
  }

  if (bundle.app !== "TermSnip" || bundle.version !== 1) {
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

  const importedHosts = sortHostCollection(bundle.hosts);
  const hostIds = new Set(importedHosts.map((host) => host.id));
  const importedKeys = sortKeys(
    bundle.keys.map((key) => ({
      ...key,
      assignedHostIds: key.assignedHostIds.filter((hostId) => hostIds.has(hostId)),
    }))
  );
  const importedSnippets = sortSnippets(
    bundle.snippets.map((snippet) => ({
      ...snippet,
      targetHostIds: snippet.targetHostIds.filter((hostId) => hostIds.has(hostId)),
    }))
  );
  const importedKnownHosts = sortKnownHosts(bundle.knownHosts);

  useHostsStore.setState((state) => ({ ...state, hosts: importedHosts }));
  useKeysStore.setState((state) => ({ ...state, keys: importedKeys }));
  useSnippetsStore.setState((state) => ({ ...state, snippets: importedSnippets }));
  useKnownHostsStore.setState((state) => ({ ...state, knownHosts: importedKnownHosts }));
  useSessionsStore.setState((state) => ({
    ...state,
    tabs: [],
    panes: {},
    activeTabId: undefined,
    lastRestoredAt: new Date().toISOString(),
  }));
  useTransfersStore.setState((state) => ({
    ...state,
    activeHostId: importedHosts[0]?.id,
    remotePathByHost: {},
    queue: [],
  }));

  return {
    hostCount: importedHosts.length,
    keyCount: importedKeys.length,
    snippetCount: importedSnippets.length,
    knownHostCount: importedKnownHosts.length,
  };
}
