import { invokeTauriCommand, isTauriRuntime } from "./backend-runtime";

export interface NativeHostSecrets {
  password: string;
  passphrase: string;
}

interface HostSecretsRequest {
  hostId: string;
}

interface StoreHostSecretsRequest extends HostSecretsRequest, NativeHostSecrets {}

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
