// UX-13: soft-delete + undo behaviour for the inventory stores.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdentitiesStore } from "./identities-store";
import { useKeysStore } from "./keys-store";
import { useSnippetsStore } from "./snippets-store";

const SNIPPET_ID = "api-tail";
const KEY_ID = "key-prod-ed25519";
const IDENTITY_ID = "identity-prod-bastion-ops";

describe("undoable deletes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSnippetsStore.setState({ pendingDeletedSnippet: undefined });
    useKeysStore.setState({ pendingDeletedKey: undefined });
    useIdentitiesStore.setState({ pendingDeletedIdentity: undefined });
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

    useSnippetsStore.getState().restoreDeletedSnippet();
    const restored = useSnippetsStore.getState().snippets.find(
      (snippet) => snippet.id === SNIPPET_ID
    );
    expect(restored).toEqual(target);
    expect(useSnippetsStore.getState().pendingDeletedSnippet).toBeUndefined();
  });

  it("snippet delete becomes permanent when the undo window expires", () => {
    useSnippetsStore.getState().deleteSnippet(SNIPPET_ID);
    expect(useSnippetsStore.getState().pendingDeletedSnippet?.id).toBe(SNIPPET_ID);

    vi.advanceTimersByTime(5_000);
    expect(useSnippetsStore.getState().pendingDeletedSnippet).toBeUndefined();

    // No restore possible after expiry.
    useSnippetsStore.getState().restoreDeletedSnippet();
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
    useSnippetsStore.getState().restoreDeletedSnippet();
    expect(useSnippetsStore.getState().snippets.some((snippet) => snippet.id === SNIPPET_ID)).toBe(
      false
    );
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

    useKeysStore.getState().restoreDeletedKey();
    expect(useKeysStore.getState().keys.find((key) => key.id === KEY_ID)).toEqual(target);
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

    useIdentitiesStore.getState().restoreDeletedIdentity();
    expect(useIdentitiesStore.getState().identities.find((identity) => identity.id === IDENTITY_ID)).toEqual(
      target
    );
  });
});
