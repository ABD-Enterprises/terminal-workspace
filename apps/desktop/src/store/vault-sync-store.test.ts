import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compactDeletionEntries,
  compactDeletionMap,
  useVaultSyncStore,
  VAULT_TOMBSTONE_MAX_ENTRIES_PER_KIND,
  VAULT_TOMBSTONE_RETENTION_DAYS,
} from "./vault-sync-store";

const baseVaultSyncState = useVaultSyncStore.getState();

// Tombstone retention is measured against the wall clock, so freeze time to a
// fixed instant just after the fixtures below. Without this the "host-live"
// fixtures age past VAULT_TOMBSTONE_RETENTION_DAYS once real "now" advances ~90
// days past their dates, and the compaction assertions rot. See #162.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-05T00:00:00.000Z"));
});

afterEach(() => {
  useVaultSyncStore.setState(baseVaultSyncState);
  vi.useRealTimers();
});

describe("vault sync tombstones", () => {
  it("compacts tombstones by removing stale entries and keeping the newest duplicate", () => {
    const now = Date.parse("2026-04-04T17:30:00.000Z");
    const staleDeletedAt = new Date(
      now - (VAULT_TOMBSTONE_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000
    ).toISOString();

    const compacted = compactDeletionEntries(
      [
        { id: "host-old", deletedAt: staleDeletedAt },
        { id: "host-a", deletedAt: "2026-04-04T17:00:00.000Z" },
        { id: "host-a", deletedAt: "2026-04-04T17:10:00.000Z" },
        { id: "host-b", deletedAt: "2026-04-04T16:59:00.000Z" },
      ],
      now
    );

    expect(compacted).toEqual([
      { id: "host-a", deletedAt: "2026-04-04T17:10:00.000Z" },
      { id: "host-b", deletedAt: "2026-04-04T16:59:00.000Z" },
    ]);
  });

  it("caps each deletion collection to the configured retention window", () => {
    const baseTime = Date.parse("2026-04-04T18:00:00.000Z");
    const entries = Array.from({ length: VAULT_TOMBSTONE_MAX_ENTRIES_PER_KIND + 8 }, (_, index) => ({
      id: `host-${index}`,
      deletedAt: new Date(baseTime - index * 1000).toISOString(),
    }));

    const compacted = compactDeletionEntries(entries, baseTime);

    expect(compacted).toHaveLength(VAULT_TOMBSTONE_MAX_ENTRIES_PER_KIND);
    expect(compacted[0]?.id).toBe("host-0");
  });

  it("applies compaction when replacing persisted tombstones", () => {
    const now = Date.parse("2026-04-04T17:30:00.000Z");
    const staleDeletedAt = new Date(
      now - (VAULT_TOMBSTONE_RETENTION_DAYS + 2) * 24 * 60 * 60 * 1000
    ).toISOString();

    useVaultSyncStore.getState().replaceDeletions(
      compactDeletionMap(
        {
          hosts: [
            { id: "host-old", deletedAt: staleDeletedAt },
            { id: "host-live", deletedAt: "2026-04-04T17:00:00.000Z" },
          ],
          keys: [],
          snippets: [],
          knownHosts: [],
        },
        now
      )
    );

    expect(useVaultSyncStore.getState().deletions.hosts).toEqual([
      { id: "host-live", deletedAt: "2026-04-04T17:00:00.000Z" },
    ]);
  });
});
