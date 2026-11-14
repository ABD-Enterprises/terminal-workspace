// UX-13: the Keychain passphrase cleanup that an undoable delete defers must
// survive quitting inside the undo window. These tests mock the native GC
// call and never touch real secrets.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nativeMocks = vi.hoisted(() => ({
  clearKey: vi.fn<(fingerprint: string) => Promise<void>>(async () => undefined),
  clearIdentity: vi.fn<(identityId: string) => Promise<void>>(async () => undefined),
}));

vi.mock("../lib/backend-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/backend-runtime")>()),
  isTauriRuntime: () => true,
}));

vi.mock("./vault-sync-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./vault-sync-store")>()),
  useVaultSyncStore: {
    getState: () => ({ markDeleted: () => undefined, clearDeleted: () => undefined }),
  },
}));

// Persist to memory so the forced "native" runtime does not try real storage IPC.
vi.mock("../lib/persistence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/persistence")>()),
  createTermsnipStorage: () => ({
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  }),
}));

vi.mock("../lib/native-secrets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/native-secrets")>()),
  clearNativeKeyPassphrase: nativeMocks.clearKey,
  clearNativeIdentityPassphrase: nativeMocks.clearIdentity,
}));

const clearKey = nativeMocks.clearKey;
const clearIdentity = nativeMocks.clearIdentity;

import { useIdentitiesStore } from "./identities-store";
import { useKeysStore } from "./keys-store";

const KEY_ID = "key-prod-ed25519";
const KEY_FINGERPRINT = "SHA256:prodGatewayDemoKey";
const IDENTITY_ID = "identity-prod-bastion-ops";

const initialKeys = useKeysStore.getState().keys;
const initialIdentities = useIdentitiesStore.getState().identities;

describe("deferred passphrase cleanup is durable", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearKey.mockClear();
    clearIdentity.mockClear();
    useKeysStore.setState({
      keys: initialKeys,
      pendingDeletedKey: undefined,
      pendingPassphraseCleanups: [],
    });
    useIdentitiesStore.setState({
      identities: initialIdentities,
      pendingDeletedIdentity: undefined,
      pendingPassphraseCleanupIds: [],
    });
  });

  afterEach(() => {
    vi.advanceTimersByTime(60_000);
    vi.useRealTimers();
  });

  it("key: records the cleanup on delete, clears it on expiry", () => {
    useKeysStore.getState().deleteKey(KEY_ID);
    expect(useKeysStore.getState().pendingPassphraseCleanups).toEqual([KEY_FINGERPRINT]);
    expect(clearKey).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5_000);
    expect(clearKey).toHaveBeenCalledWith(KEY_FINGERPRINT);
    expect(useKeysStore.getState().pendingPassphraseCleanups).toEqual([]);
  });

  it("key: Undo cancels the cleanup and drops the record", () => {
    useKeysStore.getState().deleteKey(KEY_ID);
    useKeysStore.getState().restoreDeletedKey(KEY_ID);
    expect(useKeysStore.getState().pendingPassphraseCleanups).toEqual([]);

    vi.advanceTimersByTime(10_000);
    expect(clearKey).not.toHaveBeenCalled();
  });

  it("key: a cleanup left by a quit inside the window is run at the next start", () => {
    // Simulate the persisted state after a quit: the key is gone, the cleanup remains.
    useKeysStore.setState({
      keys: useKeysStore.getState().keys.filter((key) => key.id !== KEY_ID),
      pendingPassphraseCleanups: [KEY_FINGERPRINT],
    });

    useKeysStore.getState().reconcilePendingCleanups();
    expect(clearKey).toHaveBeenCalledWith(KEY_FINGERPRINT);
    expect(useKeysStore.getState().pendingPassphraseCleanups).toEqual([]);
  });

  it("key: reconcile skips a fingerprint that a current key still uses", () => {
    useKeysStore.setState({ pendingPassphraseCleanups: [KEY_FINGERPRINT] });

    useKeysStore.getState().reconcilePendingCleanups();
    expect(clearKey).not.toHaveBeenCalled();
    expect(useKeysStore.getState().pendingPassphraseCleanups).toEqual([]);
  });

  it("key: reconcile leaves a live undo window's own cleanup alone", () => {
    useKeysStore.getState().deleteKey(KEY_ID);
    useKeysStore.getState().reconcilePendingCleanups();
    expect(clearKey).not.toHaveBeenCalled();
    expect(useKeysStore.getState().pendingPassphraseCleanups).toEqual([KEY_FINGERPRINT]);
  });

  it("identity: records the cleanup on delete, clears it on expiry", () => {
    useIdentitiesStore.getState().removeIdentity(IDENTITY_ID);
    expect(useIdentitiesStore.getState().pendingPassphraseCleanupIds).toEqual([IDENTITY_ID]);

    vi.advanceTimersByTime(5_000);
    expect(clearIdentity).toHaveBeenCalledWith(IDENTITY_ID);
    expect(useIdentitiesStore.getState().pendingPassphraseCleanupIds).toEqual([]);
  });

  it("identity: Undo cancels the cleanup and drops the record", () => {
    useIdentitiesStore.getState().removeIdentity(IDENTITY_ID);
    useIdentitiesStore.getState().restoreDeletedIdentity(IDENTITY_ID);
    expect(useIdentitiesStore.getState().pendingPassphraseCleanupIds).toEqual([]);

    vi.advanceTimersByTime(10_000);
    expect(clearIdentity).not.toHaveBeenCalled();
  });

  it("identity: a cleanup left by a quit inside the window is run at the next start", () => {
    useIdentitiesStore.setState({
      identities: useIdentitiesStore.getState().identities.filter((entry) => entry.id !== IDENTITY_ID),
      pendingPassphraseCleanupIds: [IDENTITY_ID],
    });

    useIdentitiesStore.getState().reconcilePendingCleanups();
    expect(clearIdentity).toHaveBeenCalledWith(IDENTITY_ID);
    expect(useIdentitiesStore.getState().pendingPassphraseCleanupIds).toEqual([]);
  });

  it("the pending cleanup lists are part of the persisted state", () => {
    const keysPartialize = useKeysStore.persist.getOptions().partialize!;
    const identitiesPartialize = useIdentitiesStore.persist.getOptions().partialize!;
    const keysPersisted = Object.keys(keysPartialize(useKeysStore.getState()) as object);
    const identitiesPersisted = Object.keys(
      identitiesPartialize(useIdentitiesStore.getState()) as object
    );
    expect(keysPersisted).toContain("pendingPassphraseCleanups");
    expect(keysPersisted).not.toContain("pendingDeletedKey");
    expect(identitiesPersisted).toContain("pendingPassphraseCleanupIds");
    expect(identitiesPersisted).not.toContain("pendingDeletedIdentity");
  });
});
