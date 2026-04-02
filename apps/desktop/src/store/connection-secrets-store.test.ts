import { afterEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  clearNativeHostSecrets: vi.fn(),
  isTauriRuntime: vi.fn(),
  loadNativeHostSecrets: vi.fn(),
  storeNativeHostSecrets: vi.fn(),
}));

vi.mock("../lib/backend-runtime", () => ({
  isTauriRuntime: runtimeMocks.isTauriRuntime,
}));

vi.mock("../lib/native-secrets", () => ({
  clearNativeHostSecrets: runtimeMocks.clearNativeHostSecrets,
  loadNativeHostSecrets: runtimeMocks.loadNativeHostSecrets,
  storeNativeHostSecrets: runtimeMocks.storeNativeHostSecrets,
}));

async function loadStoreModule() {
  return import("./connection-secrets-store");
}

afterEach(async () => {
  const storeModule = await loadStoreModule();
  storeModule.resetConnectionSecretsStoreForTests();
  runtimeMocks.isTauriRuntime.mockReset();
  runtimeMocks.loadNativeHostSecrets.mockReset();
  runtimeMocks.storeNativeHostSecrets.mockReset();
  runtimeMocks.clearNativeHostSecrets.mockReset();
  vi.resetModules();
});

describe("connection secrets store", () => {
  it("hydrates native secrets once and caches them in tauri mode", async () => {
    runtimeMocks.isTauriRuntime.mockReturnValue(true);
    runtimeMocks.loadNativeHostSecrets.mockResolvedValue({
      password: "vault-password",
      passphrase: "vault-passphrase",
    });

    const storeModule = await loadStoreModule();
    storeModule.resetConnectionSecretsStoreForTests();

    const firstRecord = await storeModule.hydrateHostConnectionSecrets("host-1");
    const secondRecord = await storeModule.hydrateHostConnectionSecrets("host-1");

    expect(firstRecord).toMatchObject({
      password: "vault-password",
      passphrase: "vault-passphrase",
    });
    expect(secondRecord).toMatchObject({
      password: "vault-password",
      passphrase: "vault-passphrase",
    });
    expect(storeModule.getHostConnectionSecrets("host-1")).toEqual({
      password: "vault-password",
      passphrase: "vault-passphrase",
    });
    expect(runtimeMocks.loadNativeHostSecrets).toHaveBeenCalledTimes(1);
  });

  it("persists and clears native secrets when the tauri runtime is active", async () => {
    runtimeMocks.isTauriRuntime.mockReturnValue(true);
    runtimeMocks.storeNativeHostSecrets.mockResolvedValue(undefined);
    runtimeMocks.clearNativeHostSecrets.mockResolvedValue(undefined);

    const storeModule = await loadStoreModule();
    storeModule.resetConnectionSecretsStoreForTests();

    storeModule.useConnectionSecretsStore.getState().setHostSecrets("host-2", {
      password: "persisted-password",
      passphrase: "",
    });

    await Promise.resolve();

    expect(storeModule.getHostConnectionSecrets("host-2")).toEqual({
      password: "persisted-password",
      passphrase: "",
    });
    expect(runtimeMocks.storeNativeHostSecrets).toHaveBeenCalledWith("host-2", {
      password: "persisted-password",
      passphrase: "",
    });

    storeModule.useConnectionSecretsStore.getState().clearHostSecrets("host-2");

    await Promise.resolve();

    expect(storeModule.getHostConnectionSecrets("host-2")).toEqual({
      password: "",
      passphrase: "",
    });
    expect(runtimeMocks.clearNativeHostSecrets).toHaveBeenCalledWith("host-2");
  });
});
