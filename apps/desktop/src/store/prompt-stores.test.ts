import { describe, expect, it } from "vitest";
import { useConnectionSecretPromptStore } from "./connection-secret-prompt-store";
import { useFingerprintTrustPromptStore } from "./fingerprint-trust-prompt-store";

describe("prompt stores", () => {
  it("connection secret prompt resolves through the public store", async () => {
    const request = {
      actionLabel: "Connect",
      hostId: "prod-gateway",
      hostLabel: "Production Gateway",
      hostname: "bastion.acme.internal",
      needsPassphrase: true,
      needsPassword: false,
      username: "ops",
    };
    const pending = useConnectionSecretPromptStore.getState().openPrompt(request);

    expect(useConnectionSecretPromptStore.getState().pendingRequest).toEqual(request);
    useConnectionSecretPromptStore.getState().clearPrompt(true);
    await expect(pending).resolves.toBe(true);
  });

  it("fingerprint trust prompt resolves selected scan candidate", async () => {
    const candidate = {
      algorithm: "ssh-ed25519",
      fingerprint: "SHA256:demo",
      hostname: "bastion.acme.internal",
      port: 22,
      publicKey: "AAAAdemo",
    };
    const pending = useFingerprintTrustPromptStore.getState().openPrompt({
      candidates: [candidate],
      hostId: "prod-gateway",
      hostLabel: "Production Gateway",
      hostname: "bastion.acme.internal",
      port: 22,
    });

    expect(useFingerprintTrustPromptStore.getState().pendingRequest?.hostLabel).toBe(
      "Production Gateway",
    );
    useFingerprintTrustPromptStore.getState().clearPrompt(candidate);
    await expect(pending).resolves.toBe(candidate);
  });
});
