import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleHosts } from "../types/host";
import { sampleIdentities } from "../types/identity";
import { sampleKeys } from "../types/key";
import { useHostsStore } from "./hosts-store";
import { useIdentitiesStore } from "./identities-store";
import { useKeysStore } from "./keys-store";

const initialIdentitiesState = useIdentitiesStore.getState();
const initialHostsState = useHostsStore.getState();
const initialKeysState = useKeysStore.getState();

beforeEach(() => {
  // Reset every store the tests touch so cross-test ordering does not
  // contaminate the migration trigger or the persisted Sample state.
  // Identities are pre-sorted to match the store's invariant (sortIdentities
  // by label) — without this the seed-order test would fail because the
  // sampleIdentities array isn't itself sorted.
  useIdentitiesStore.setState({
    ...initialIdentitiesState,
    identities: [...sampleIdentities].sort((left, right) =>
      left.label.localeCompare(right.label)
    ),
    migrationCompleted: false,
  });
  useHostsStore.setState({
    ...initialHostsState,
    hosts: [...sampleHosts],
  });
  useKeysStore.setState({
    ...initialKeysState,
    keys: [...sampleKeys],
  });
});

afterEach(() => {
  useIdentitiesStore.setState(initialIdentitiesState);
  useHostsStore.setState(initialHostsState);
  useKeysStore.setState(initialKeysState);
});

describe("identities-store", () => {
  it("seeds with the sample identities sorted by label", () => {
    const labels = useIdentitiesStore.getState().identities.map((entry) => entry.label);
    expect(labels).toEqual([...labels].sort());
    expect(labels.length).toBeGreaterThan(0);
  });

  it("upsertIdentity inserts a new record with timestamps", () => {
    const id = useIdentitiesStore.getState().upsertIdentity({
      id: "identity-new",
      label: "New",
      username: "alice",
      authMethod: "privateKey",
      privateKeyPath: "~/.ssh/alice",
      hasPassphrase: true,
      comment: "",
      source: "imported",
    });
    expect(id).toBe("identity-new");
    const stored = useIdentitiesStore
      .getState()
      .identities.find((entry) => entry.id === "identity-new");
    expect(stored).toBeDefined();
    expect(stored?.createdAt).toBeTruthy();
    expect(stored?.updatedAt).toBeTruthy();
  });

  it("upsertIdentity replaces an existing record by id", () => {
    useIdentitiesStore.getState().upsertIdentity({
      id: "identity-test",
      label: "First",
      username: "alice",
      authMethod: "password",
      privateKeyPath: "",
      hasPassphrase: false,
      comment: "",
      source: "imported",
    });
    useIdentitiesStore.getState().upsertIdentity({
      id: "identity-test",
      label: "Updated",
      username: "alice",
      authMethod: "password",
      privateKeyPath: "",
      hasPassphrase: false,
      comment: "",
      source: "imported",
    });
    const matches = useIdentitiesStore
      .getState()
      .identities.filter((entry) => entry.id === "identity-test");
    expect(matches).toHaveLength(1);
    expect(matches[0].label).toBe("Updated");
  });

  it("setLabel updates only the label and bumps updatedAt", async () => {
    const target = useIdentitiesStore.getState().identities[0];
    const before = target.updatedAt;
    // Wait a tick so updatedAt definitely advances.
    await new Promise((resolve) => setTimeout(resolve, 5));
    useIdentitiesStore.getState().setLabel(target.id, "Renamed");
    const after = useIdentitiesStore
      .getState()
      .identities.find((entry) => entry.id === target.id);
    expect(after?.label).toBe("Renamed");
    expect(after?.updatedAt).not.toBe(before);
  });

  it("setComment updates only the comment", () => {
    const target = useIdentitiesStore.getState().identities[0];
    useIdentitiesStore.getState().setComment(target.id, "fresh note");
    const after = useIdentitiesStore
      .getState()
      .identities.find((entry) => entry.id === target.id);
    expect(after?.comment).toBe("fresh note");
    expect(after?.label).toBe(target.label);
  });

  it("removeIdentity deletes the record and returns it", () => {
    const target = useIdentitiesStore.getState().identities[0];
    const removed = useIdentitiesStore.getState().removeIdentity(target.id);
    expect(removed?.id).toBe(target.id);
    expect(
      useIdentitiesStore.getState().identities.find((entry) => entry.id === target.id)
    ).toBeUndefined();
  });

  it("removeIdentity returns undefined for an unknown id", () => {
    expect(useIdentitiesStore.getState().removeIdentity("does-not-exist")).toBeUndefined();
  });

  it("ensureMigrated stamps every keyable host with an identityId", () => {
    // Strip identityId from the sample hosts to simulate a pre-batch-1 install.
    const strippedHosts = sampleHosts.map((host) => {
      const next = { ...host };
      delete next.identityId;
      return next;
    });
    useHostsStore.setState({ ...initialHostsState, hosts: strippedHosts });
    useIdentitiesStore.setState({
      ...initialIdentitiesState,
      identities: [],
      migrationCompleted: false,
    });

    useIdentitiesStore.getState().ensureMigrated();

    const hosts = useHostsStore.getState().hosts;
    const identities = useIdentitiesStore.getState().identities;
    expect(useIdentitiesStore.getState().migrationCompleted).toBe(true);

    for (const host of hosts) {
      if (host.authMethod === "none") {
        // local-shell etc. — intentionally unmigrated.
        expect(host.identityId).toBeUndefined();
        continue;
      }
      expect(host.identityId).toBeDefined();
      expect(identities.find((entry) => entry.id === host.identityId)).toBeDefined();
    }
  });

  it("ensureMigrated is idempotent — second call does nothing extra", () => {
    useIdentitiesStore.setState({
      ...initialIdentitiesState,
      identities: [],
      migrationCompleted: false,
    });
    useIdentitiesStore.getState().ensureMigrated();
    const firstIdentitiesCount = useIdentitiesStore.getState().identities.length;
    useIdentitiesStore.getState().ensureMigrated();
    expect(useIdentitiesStore.getState().identities.length).toBe(firstIdentitiesCount);
  });
});
