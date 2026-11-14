// UX-13: soft-delete + undo behaviour for the inventory stores.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyImportedLocalConfigBundle, buildLocalConfigBundle } from "../lib/local-config";
import { useIdentitiesStore } from "./identities-store";
import { useKeysStore } from "./keys-store";
import { useSnippetsStore } from "./snippets-store";
import { pushUndoToast } from "../lib/undo-toast";
import { useToastStore } from "./toast-store";
import { useVaultSyncStore } from "./vault-sync-store";

const SNIPPET_ID = "api-tail";
const KEY_ID = "key-prod-ed25519";
const IDENTITY_ID = "identity-prod-bastion-ops";

const initial = {
  snippets: useSnippetsStore.getState().snippets,
  keys: useKeysStore.getState().keys,
  identities: useIdentitiesStore.getState().identities,
  deletions: useVaultSyncStore.getState().deletions,
};

describe("undoable deletes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Start every test from the same inventory; earlier deletes are permanent.
    useSnippetsStore.setState({ snippets: initial.snippets, pendingDeletedSnippet: undefined });
    useKeysStore.setState({ keys: initial.keys, pendingDeletedKey: undefined });
    useIdentitiesStore.setState({
      identities: initial.identities,
      pendingDeletedIdentity: undefined,
    });
    useVaultSyncStore.setState({ deletions: initial.deletions });
  });

  afterEach(() => {
    vi.useRealTimers();
    // Expire any window left open so its timer cannot leak into other suites.
    vi.useFakeTimers();
    vi.advanceTimersByTime(60_000);
    vi.useRealTimers();
  });

  it("snippet delete removes it from the list and undo restores it", () => {
    const before = useSnippetsStore.getState().snippets;
    const target = before.find((snippet) => snippet.id === SNIPPET_ID);
    expect(target).toBeDefined();

    useSnippetsStore.getState().deleteSnippet(SNIPPET_ID);
    expect(useSnippetsStore.getState().snippets.some((snippet) => snippet.id === SNIPPET_ID)).toBe(
      false
    );

    useSnippetsStore.getState().restoreDeletedSnippet(SNIPPET_ID);
    const restored = useSnippetsStore.getState().snippets.find(
      (snippet) => snippet.id === SNIPPET_ID
    );
    expect(restored).toEqual({ ...target, updatedAt: expect.any(String) });
    expect(useSnippetsStore.getState().pendingDeletedSnippet).toBeUndefined();
  });

  it("snippet delete becomes permanent when the undo window expires", () => {
    useSnippetsStore.getState().deleteSnippet(SNIPPET_ID);
    expect(useSnippetsStore.getState().pendingDeletedSnippet?.id).toBe(SNIPPET_ID);

    vi.advanceTimersByTime(5_000);
    expect(useSnippetsStore.getState().pendingDeletedSnippet).toBeUndefined();

    // No restore possible after expiry.
    useSnippetsStore.getState().restoreDeletedSnippet(SNIPPET_ID);
    expect(useSnippetsStore.getState().snippets.some((snippet) => snippet.id === SNIPPET_ID)).toBe(
      false
    );
  });

  it("a second snippet delete expires the first window", () => {
    const ids = useSnippetsStore.getState().snippets.map((snippet) => snippet.id);
    const otherId = ids.find((id) => id !== SNIPPET_ID);
    expect(otherId).toBeDefined();

    useSnippetsStore.getState().deleteSnippet(SNIPPET_ID);
    useSnippetsStore.getState().deleteSnippet(otherId!);

    expect(useSnippetsStore.getState().pendingDeletedSnippet?.id).toBe(otherId);

    // The first record is gone for good — expiry already ran for it.
    useSnippetsStore.getState().restoreDeletedSnippet(SNIPPET_ID);
    expect(useSnippetsStore.getState().snippets.some((snippet) => snippet.id === SNIPPET_ID)).toBe(
      false
    );
    expect(useSnippetsStore.getState().snippets.some((snippet) => snippet.id === otherId)).toBe(
      false
    );

    // Undo bound to the newest deletion still works.
    useSnippetsStore.getState().restoreDeletedSnippet(otherId!);
    expect(useSnippetsStore.getState().snippets.some((snippet) => snippet.id === otherId)).toBe(
      true
    );
  });

  it("key delete is undoable within the window", () => {
    const before = useKeysStore.getState().keys;
    const target = before.find((key) => key.id === KEY_ID);
    expect(target).toBeDefined();

    const returned = useKeysStore.getState().deleteKey(KEY_ID);
    expect(returned?.id).toBe(KEY_ID);
    expect(useKeysStore.getState().keys.some((key) => key.id === KEY_ID)).toBe(false);

    useKeysStore.getState().restoreDeletedKey(KEY_ID);
    expect(useKeysStore.getState().keys.find((key) => key.id === KEY_ID)).toEqual({
      ...target,
      updatedAt: expect.any(String),
    });
  });

  it("identity delete is undoable within the window", () => {
    const before = useIdentitiesStore.getState().identities;
    const target = before.find((identity) => identity.id === IDENTITY_ID);
    expect(target).toBeDefined();

    const returned = useIdentitiesStore.getState().removeIdentity(IDENTITY_ID);
    expect(returned?.id).toBe(IDENTITY_ID);
    expect(
      useIdentitiesStore.getState().identities.some((identity) => identity.id === IDENTITY_ID)
    ).toBe(false);

    useIdentitiesStore.getState().restoreDeletedIdentity(IDENTITY_ID);
    expect(
      useIdentitiesStore.getState().identities.find((identity) => identity.id === IDENTITY_ID)
    ).toEqual({ ...target, updatedAt: expect.any(String) });
  });

  it("a stale snippet Undo does not restore a newer deletion", () => {
    const otherId = useSnippetsStore
      .getState()
      .snippets.map((snippet) => snippet.id)
      .find((id) => id !== SNIPPET_ID)!;
    useSnippetsStore.getState().deleteSnippet(SNIPPET_ID);
    useSnippetsStore.getState().deleteSnippet(otherId);

    expect(useSnippetsStore.getState().restoreDeletedSnippet(SNIPPET_ID)).toBeUndefined();
    expect(useSnippetsStore.getState().pendingDeletedSnippet?.id).toBe(otherId);
    expect(useSnippetsStore.getState().snippets.some((snippet) => snippet.id === otherId)).toBe(
      false
    );
  });

  it("a stale key Undo does not restore a newer deletion", () => {
    const otherId = useKeysStore
      .getState()
      .keys.map((key) => key.id)
      .find((id) => id !== KEY_ID)!;
    useKeysStore.getState().deleteKey(KEY_ID);
    useKeysStore.getState().deleteKey(otherId);

    expect(useKeysStore.getState().restoreDeletedKey(KEY_ID)).toBeUndefined();
    expect(useKeysStore.getState().pendingDeletedKey?.id).toBe(otherId);
    expect(useKeysStore.getState().keys.some((key) => key.id === otherId)).toBe(false);
    expect(useKeysStore.getState().restoreDeletedKey(otherId)?.id).toBe(otherId);
  });

  it("a stale identity Undo does not restore a newer deletion", () => {
    const otherId = useIdentitiesStore
      .getState()
      .identities.map((identity) => identity.id)
      .find((id) => id !== IDENTITY_ID)!;
    useIdentitiesStore.getState().removeIdentity(IDENTITY_ID);
    useIdentitiesStore.getState().removeIdentity(otherId);

    expect(useIdentitiesStore.getState().restoreDeletedIdentity(IDENTITY_ID)).toBeUndefined();
    expect(useIdentitiesStore.getState().pendingDeletedIdentity?.id).toBe(otherId);
    expect(useIdentitiesStore.getState().restoreDeletedIdentity(otherId)?.id).toBe(otherId);
  });

  it("a snapshot taken before Undo cannot delete the restored record on merge", () => {
    vi.setSystemTime(new Date("2026-04-05T00:00:00.000Z"));
    useSnippetsStore.getState().deleteSnippet(SNIPPET_ID);
    useKeysStore.getState().deleteKey(KEY_ID);
    useIdentitiesStore.getState().removeIdentity(IDENTITY_ID);

    // A configuration snapshot that captured the deletions.
    const snapshot = JSON.parse(JSON.stringify(buildLocalConfigBundle()));
    expect(snapshot.deletions.snippets.map((entry: { id: string }) => entry.id)).toContain(
      SNIPPET_ID
    );

    // Undo within the same instant: the restored records must still count as newer.
    useSnippetsStore.getState().restoreDeletedSnippet(SNIPPET_ID);
    useKeysStore.getState().restoreDeletedKey(KEY_ID);
    useIdentitiesStore.getState().restoreDeletedIdentity(IDENTITY_ID);

    // keep-local only settles an unrelated built-in host conflict in this fixture.
    applyImportedLocalConfigBundle(snapshot, { mode: "merge", conflictResolution: "keep-local" });

    expect(useSnippetsStore.getState().snippets.some((entry) => entry.id === SNIPPET_ID)).toBe(
      true
    );
    expect(useKeysStore.getState().keys.some((entry) => entry.id === KEY_ID)).toBe(true);
    expect(
      useIdentitiesStore.getState().identities.some((entry) => entry.id === IDENTITY_ID)
    ).toBe(true);
  });

  it("Undo is a no-op when the inventory already has the id", () => {
    const snippet = useSnippetsStore.getState().snippets.find((entry) => entry.id === SNIPPET_ID)!;
    const key = useKeysStore.getState().keys.find((entry) => entry.id === KEY_ID)!;
    const identity = useIdentitiesStore
      .getState()
      .identities.find((entry) => entry.id === IDENTITY_ID)!;
    useSnippetsStore.getState().deleteSnippet(SNIPPET_ID);
    useKeysStore.getState().deleteKey(KEY_ID);
    useIdentitiesStore.getState().removeIdentity(IDENTITY_ID);

    // Something else (an import) put the same ids back during the window.
    useSnippetsStore.setState((state) => ({ snippets: [...state.snippets, snippet] }));
    useKeysStore.setState((state) => ({ keys: [...state.keys, key] }));
    useIdentitiesStore.setState((state) => ({ identities: [...state.identities, identity] }));

    expect(useSnippetsStore.getState().restoreDeletedSnippet(SNIPPET_ID)).toBeUndefined();
    expect(useKeysStore.getState().restoreDeletedKey(KEY_ID)).toBeUndefined();
    expect(useIdentitiesStore.getState().restoreDeletedIdentity(IDENTITY_ID)).toBeUndefined();

    const count = <T extends { id: string }>(records: T[], id: string) =>
      records.filter((record) => record.id === id).length;
    expect(count(useSnippetsStore.getState().snippets, SNIPPET_ID)).toBe(1);
    expect(count(useKeysStore.getState().keys, KEY_ID)).toBe(1);
    expect(count(useIdentitiesStore.getState().identities, IDENTITY_ID)).toBe(1);
    expect(useSnippetsStore.getState().pendingDeletedSnippet).toBeUndefined();
    expect(useKeysStore.getState().pendingDeletedKey).toBeUndefined();
    expect(useIdentitiesStore.getState().pendingDeletedIdentity).toBeUndefined();
  });

  it("an import during the window that already has the records leaves no duplicates", () => {
    const bundle = JSON.parse(JSON.stringify(buildLocalConfigBundle()));
    useSnippetsStore.getState().deleteSnippet(SNIPPET_ID);
    useKeysStore.getState().deleteKey(KEY_ID);
    useIdentitiesStore.getState().removeIdentity(IDENTITY_ID);

    applyImportedLocalConfigBundle(bundle, { mode: "replace" });
    expect(useSnippetsStore.getState().pendingDeletedSnippet).toBeUndefined();
    expect(useKeysStore.getState().pendingDeletedKey).toBeUndefined();
    expect(useIdentitiesStore.getState().pendingDeletedIdentity).toBeUndefined();

    useSnippetsStore.getState().restoreDeletedSnippet(SNIPPET_ID);
    useKeysStore.getState().restoreDeletedKey(KEY_ID);
    useIdentitiesStore.getState().restoreDeletedIdentity(IDENTITY_ID);

    const count = <T extends { id: string }>(records: T[], id: string) =>
      records.filter((record) => record.id === id).length;
    expect(count(useSnippetsStore.getState().snippets, SNIPPET_ID)).toBe(1);
    expect(count(useKeysStore.getState().keys, KEY_ID)).toBe(1);
    expect(count(useIdentitiesStore.getState().identities, IDENTITY_ID)).toBe(1);
  });

  it("an import during the window that lacks the records cannot be undone into them", () => {
    useSnippetsStore.getState().deleteSnippet(SNIPPET_ID);
    useKeysStore.getState().deleteKey(KEY_ID);
    useIdentitiesStore.getState().removeIdentity(IDENTITY_ID);
    pushUndoToast("snippets", "Deleted snippet", vi.fn());
    pushUndoToast("keys", "Deleted key", vi.fn());
    pushUndoToast("identities", "Deleted identity", vi.fn());
    expect(useToastStore.getState().toasts).toHaveLength(3);

    // Snapshot of another inventory that never had these records.
    const bundle = JSON.parse(JSON.stringify(buildLocalConfigBundle()));
    bundle.snippets = bundle.snippets.filter((entry: { id: string }) => entry.id !== SNIPPET_ID);
    applyImportedLocalConfigBundle(bundle, { mode: "replace" });

    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(useSnippetsStore.getState().restoreDeletedSnippet(SNIPPET_ID)).toBeUndefined();
    expect(useKeysStore.getState().restoreDeletedKey(KEY_ID)).toBeUndefined();
    expect(useIdentitiesStore.getState().restoreDeletedIdentity(IDENTITY_ID)).toBeUndefined();
    expect(useSnippetsStore.getState().snippets.some((entry) => entry.id === SNIPPET_ID)).toBe(
      false
    );
    expect(useKeysStore.getState().keys.some((entry) => entry.id === KEY_ID)).toBe(false);
    expect(
      useIdentitiesStore.getState().identities.some((entry) => entry.id === IDENTITY_ID)
    ).toBe(false);
  });
});
