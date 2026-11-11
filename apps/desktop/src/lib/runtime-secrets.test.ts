import { beforeEach, expect, it, vi } from "vitest";
import type { HostRecord } from "../types/host";

const mocks = vi.hoisted(() => ({
  hydrate: vi.fn(),
  generation: 0,
  secrets: vi.fn(),
  prompt: vi.fn(),
  hosts: [] as HostRecord[],
}));

vi.mock("../store/app-store", () => ({ isDemoModeEnabled: () => false }));
vi.mock("../store/connection-secrets-store", () => ({
  getHostConnectionSecrets: mocks.secrets,
  getConnectionSecretsGeneration: () => mocks.generation,
  hydrateHostConnectionSecrets: mocks.hydrate,
}));
vi.mock("../store/connection-secret-prompt-utils", () => ({
  requestConnectionSecretsPrompt: mocks.prompt,
}));
vi.mock("../store/hosts-store", () => ({
  useHostsStore: { getState: () => ({ hosts: mocks.hosts }) },
}));
vi.mock("../store/keys-store", () => ({
  useKeysStore: { getState: () => ({ keys: [] }) },
}));

import { canRestoreSessionWithoutPrompt, ensureRuntimeSecrets } from "./runtime-secrets";

const host = { id: "fixture-host", authMethod: "password" } as HostRecord;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.generation = 0;
  mocks.hosts = [host];
  mocks.secrets.mockReturnValue({ password: "", passphrase: "" });
});

it("does not read saved credentials or prompt during background restoration", async () => {
  expect(await canRestoreSessionWithoutPrompt(host)).toBe(false);
  expect(await ensureRuntimeSecrets(host, "Restore", { interactive: false })).toBe(false);
  expect(mocks.hydrate).not.toHaveBeenCalled();
  expect(mocks.prompt).not.toHaveBeenCalled();
});

it("restores with credentials already held in the current app session", async () => {
  mocks.secrets.mockReturnValue({ password: "fixture-secret", passphrase: "" });
  expect(await canRestoreSessionWithoutPrompt(host)).toBe(true);
  expect(await ensureRuntimeSecrets(host, "Restore", { interactive: false })).toBe(true);
  expect(mocks.hydrate).not.toHaveBeenCalled();
});

it("checks every jump host without reading the keychain in the background", async () => {
  const target = { ...host, id: "fixture-target", jumpHostId: host.id };
  mocks.hosts = [host, target];
  mocks.secrets.mockImplementation((id) => ({
    password: id === target.id ? "fixture-secret" : "", passphrase: "",
  }));
  expect(await canRestoreSessionWithoutPrompt(target)).toBe(false);
  expect(await ensureRuntimeSecrets(target, "Restore", { interactive: false })).toBe(false);
  expect(mocks.hydrate).not.toHaveBeenCalled();
});

it("allows an interactive connection to request saved credentials", async () => {
  mocks.hydrate.mockImplementation(async () => {
    mocks.secrets.mockReturnValue({ password: "fixture-secret", passphrase: "" });
  });
  expect(await ensureRuntimeSecrets(host, "Connect")).toBe(true);
  expect(mocks.hydrate).toHaveBeenCalledWith(host.id);
  expect(mocks.prompt).not.toHaveBeenCalled();
});

it("still permits manual entry when saved credentials were not released", async () => {
  mocks.prompt.mockResolvedValue(false);
  expect(await ensureRuntimeSecrets(host, "Connect")).toBe(false);
  expect(mocks.hydrate).toHaveBeenCalledWith(host.id);
  expect(mocks.prompt).toHaveBeenCalledOnce();
});

it("abandons a connection if inventory changes during native approval", async () => {
  mocks.hydrate.mockImplementation(async () => { mocks.generation += 1; });
  expect(await ensureRuntimeSecrets(host, "Connect")).toBe(false);
  expect(mocks.prompt).not.toHaveBeenCalled();
});

it("abandons a connection if inventory changes during manual entry", async () => {
  mocks.prompt.mockImplementation(async () => { mocks.generation += 1; return true; });
  expect(await ensureRuntimeSecrets(host, "Connect")).toBe(false);
});

it("abandons even a credential-free connection when its host is cleared during approval", async () => {
  mocks.hydrate.mockImplementation(async () => { mocks.generation += 1; });
  const keyHost = { ...host, authMethod: "privateKey", privateKeyPath: "/fixture/key" } as HostRecord;
  mocks.hosts = [keyHost];
  expect(await ensureRuntimeSecrets(keyHost, "Connect")).toBe(false);
});
