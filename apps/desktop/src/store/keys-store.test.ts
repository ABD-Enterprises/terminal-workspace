import { describe, expect, it } from "vitest";
import { sampleKeys, type KeyMetadata } from "../types/key";
import { useKeysStore } from "./keys-store";

describe("keys store", () => {
  it("upserts imported keys by private path and moves host assignments", () => {
    useKeysStore.setState({ keys: sampleKeys });
    const metadata: KeyMetadata = {
      algorithm: "ED25519",
      bits: 256,
      comment: "rotated@host",
      fingerprint: "SHA256:rotated",
      privateKeyPath: "~/.ssh/id_ed25519",
      publicKeyPath: "~/.ssh/id_ed25519.pub",
    };

    const id = useKeysStore.getState().importKey("Rotated Prod Key", metadata, true);
    expect(useKeysStore.getState().keys).toHaveLength(sampleKeys.length);
    expect(useKeysStore.getState().keys.find((key) => key.id === id)).toMatchObject({
      comment: "rotated@host",
      fingerprint: "SHA256:rotated",
      label: "Rotated Prod Key",
    });

    useKeysStore.getState().assignHost(id, "billing-api");

    const keys = useKeysStore.getState().keys;
    expect(keys.find((key) => key.id === id)?.assignedHostIds).toContain("billing-api");
    expect(keys.find((key) => key.id !== id)?.assignedHostIds).not.toContain("billing-api");
  });
});
