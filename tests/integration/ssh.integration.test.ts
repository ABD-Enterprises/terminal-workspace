import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  executeSnippetOnHosts,
  generatePrivateKey,
  inspectPrivateKey,
  scanKnownHost,
} from "../../apps/desktop/src/lib/api";
import { resetDemoBackend } from "../../apps/desktop/src/lib/demo-backend";
import { useAppStore } from "../../apps/desktop/src/store/app-store";

const baseAppState = useAppStore.getState();

beforeEach(() => {
  resetDemoBackend();
  useAppStore.setState({
    ...useAppStore.getState(),
    demoModeEnabled: true,
  });
});

afterEach(() => {
  resetDemoBackend();
  useAppStore.setState(baseAppState);
});

describe("demo ssh workflows", () => {
  it("inspects and generates keys without touching the local filesystem", async () => {
    const importedKey = await inspectPrivateKey("~/.ssh/id_ed25519");
    const generatedKey = await generatePrivateKey({
      comment: "ops@demo",
      passphrase: "",
      path: "~/.ssh/termsnip_demo",
      type: "rsa",
    });

    expect(importedKey.algorithm).toBe("ED25519");
    expect(importedKey.publicKeyPath).toBe("~/.ssh/id_ed25519.pub");
    expect(generatedKey.algorithm).toBe("RSA");
    expect(generatedKey.bits).toBe(4096);
    expect(generatedKey.privateKeyPath).toBe("~/.ssh/termsnip_demo");
  });

  it("scans demo known hosts and returns deterministic snippet execution results", async () => {
    const scanResult = await scanKnownHost("bastion.acme.internal", 22);
    const executionResult = await executeSnippetOnHosts("uptime", [
      {
        id: "prod-gateway",
        label: "Production Gateway",
        host: {
          agentForwarding: true,
          authMethod: "privateKey",
          environment: {
            APP_ENV: "production",
          },
          hostname: "bastion.acme.internal",
          password: "",
          passphrase: "",
          port: 22,
          privateKeyPath: "~/.ssh/id_ed25519",
          sftpRoot: "/srv",
          username: "ops",
        },
      },
    ]);

    expect(scanResult.entries).toHaveLength(1);
    expect(scanResult.entries[0]?.algorithm).toBe("ssh-ed25519");
    expect(executionResult.results).toEqual([
      expect.objectContaining({
        ok: true,
        exitCode: 0,
        label: "Production Gateway",
      }),
    ]);
    expect(executionResult.results[0]?.stdout).toContain("uptime");
  });
});
