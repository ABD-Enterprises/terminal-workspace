import { create } from "zustand";

export interface ConnectionSecretRecord {
  password: string;
  passphrase: string;
  updatedAt: string;
}

interface ConnectionSecretsState {
  secretsByHostId: Record<string, ConnectionSecretRecord>;
  setHostSecrets: (hostId: string, values: { password: string; passphrase: string }) => void;
  clearHostSecrets: (hostId: string) => void;
}

export const useConnectionSecretsStore = create<ConnectionSecretsState>((set) => ({
  secretsByHostId: {},
  setHostSecrets: (hostId, values) =>
    set((state) => ({
      secretsByHostId: {
        ...state.secretsByHostId,
        [hostId]: {
          password: values.password,
          passphrase: values.passphrase,
          updatedAt: new Date().toISOString(),
        },
      },
    })),
  clearHostSecrets: (hostId) =>
    set((state) => {
      const nextSecrets = { ...state.secretsByHostId };
      delete nextSecrets[hostId];

      return {
        secretsByHostId: nextSecrets,
      };
    }),
}));

export function getHostConnectionSecrets(hostId: string) {
  const record = useConnectionSecretsStore.getState().secretsByHostId[hostId];

  return {
    password: record?.password ?? "",
    passphrase: record?.passphrase ?? "",
  };
}
