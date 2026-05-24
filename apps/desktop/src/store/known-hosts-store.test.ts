import { describe, expect, it } from "vitest";
import { createKnownHostId, sampleKnownHosts } from "../types/known-host";
import { useKnownHostsStore } from "./known-hosts-store";

describe("known hosts store", () => {
  it("trusts by stable host key id and removes tombstoned entries", () => {
    useKnownHostsStore.setState({ knownHosts: sampleKnownHosts });
    const scan = {
      algorithm: "ssh-ed25519",
      fingerprint: "SHA256:new",
      hostname: "new.example.internal",
      port: 2222,
      publicKey: "AAAANew",
    };

    useKnownHostsStore.getState().trustKnownHost(scan);
    const id = createKnownHostId(scan);
    expect(useKnownHostsStore.getState().knownHosts.some((entry) => entry.id === id)).toBe(true);

    useKnownHostsStore.getState().removeKnownHost(id);
    expect(useKnownHostsStore.getState().knownHosts.some((entry) => entry.id === id)).toBe(false);
  });
});
