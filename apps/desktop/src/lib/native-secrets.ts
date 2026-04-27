import { invokeTauriCommand, isTauriRuntime } from "./backend-runtime";

export interface NativeHostSecrets {
  password: string;
  passphrase: string;
}

interface HostSecretsRequest {
  hostId: string;
}

interface StoreHostSecretsRequest extends HostSecretsRequest, NativeHostSecrets {}

interface KeyPassphraseRequest {
  fingerprint: string;
}

interface StoreKeyPassphraseRequest extends KeyPassphraseRequest {
  passphrase: string;
}

interface KeyPassphraseResponse {
  passphrase: string;
}

const emptySecrets: NativeHostSecrets = {
  password: "",
  passphrase: "",
};

export async function loadNativeHostSecrets(hostId: string): Promise<NativeHostSecrets> {
  if (!isTauriRuntime()) {
    return emptySecrets;
  }

  return invokeTauriCommand<NativeHostSecrets>("termsnip_load_host_secrets", {
    request: {
      hostId,
    } satisfies HostSecretsRequest,
  });
}

export async function storeNativeHostSecrets(hostId: string, secrets: NativeHostSecrets) {
  if (!isTauriRuntime()) {
    return;
  }

  await invokeTauriCommand("termsnip_store_host_secrets", {
    request: {
      hostId,
      passphrase: secrets.passphrase,
      password: secrets.password,
    } satisfies StoreHostSecretsRequest,
  });
}

export async function clearNativeHostSecrets(hostId: string) {
  if (!isTauriRuntime()) {
    return;
  }

  await invokeTauriCommand("termsnip_clear_host_secrets", {
    request: {
      hostId,
    } satisfies HostSecretsRequest,
  });
}

// ---- Per-key-fingerprint passphrase plumbing ------------------------------
// Multiple hosts that share the same private key now share a single Keychain
// entry keyed by the SSH fingerprint, so the user only types the passphrase
// once per key. The per-host functions above remain for password storage
// (passwords are intrinsically per-host) and for migrating existing per-host
// passphrase entries forward. See parity-and-hardening-plan.md P1-S5.

export async function loadNativeKeyPassphrase(fingerprint: string): Promise<string> {
  if (!isTauriRuntime()) {
    return "";
  }

  const response = await invokeTauriCommand<KeyPassphraseResponse>(
    "termsnip_load_key_passphrase",
    {
      request: { fingerprint } satisfies KeyPassphraseRequest,
    }
  );
  return response.passphrase ?? "";
}

export async function storeNativeKeyPassphrase(fingerprint: string, passphrase: string) {
  if (!isTauriRuntime()) {
    return;
  }

  await invokeTauriCommand("termsnip_store_key_passphrase", {
    request: { fingerprint, passphrase } satisfies StoreKeyPassphraseRequest,
  });
}

export async function clearNativeKeyPassphrase(fingerprint: string) {
  if (!isTauriRuntime()) {
    return;
  }

  await invokeTauriCommand("termsnip_clear_key_passphrase", {
    request: { fingerprint } satisfies KeyPassphraseRequest,
  });
}
