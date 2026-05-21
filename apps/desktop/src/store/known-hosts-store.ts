import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createTermsnipStorage } from "../lib/persistence";
import type { KnownHostScanResult } from "../lib/api";
import {
  createKnownHostId,
  createKnownHostRecord,
  sampleKnownHosts,
  type KnownHostRecord,
} from "../types/known-host";
import { useVaultSyncStore } from "./vault-sync-store";

function sortKnownHosts(knownHosts: KnownHostRecord[]) {
  return [...knownHosts].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

interface KnownHostsState {
  knownHosts: KnownHostRecord[];
  trustKnownHost: (entry: KnownHostScanResult) => void;
  removeKnownHost: (knownHostId: string) => void;
}

export const useKnownHostsStore = create<KnownHostsState>()(
  persist(
    (set) => ({
      knownHosts: sortKnownHosts(sampleKnownHosts),
      trustKnownHost: (entry) =>
        set((state) => {
          const record = createKnownHostRecord(entry);
          const existingId = createKnownHostId(record);
          useVaultSyncStore.getState().clearDeleted("knownHosts", existingId);

          return {
            knownHosts: sortKnownHosts([
              record,
              ...state.knownHosts.filter((knownHost) => knownHost.id !== existingId),
            ]),
          };
        }),
      removeKnownHost: (knownHostId) =>
        set((state) => {
          useVaultSyncStore.getState().markDeleted("knownHosts", knownHostId);
          return {
            knownHosts: sortKnownHosts(
              state.knownHosts.filter((knownHost) => knownHost.id !== knownHostId)
            ),
          };
        }),
    }),
    {
      name: "termsnip-known-hosts",
      storage: createJSONStorage(() => createTermsnipStorage("termsnip-known-hosts")),
    }
  )
);
