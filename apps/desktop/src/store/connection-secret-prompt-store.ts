import { create } from "zustand";

export interface ConnectionSecretPromptRequest {
  actionLabel: string;
  hostId: string;
  hostLabel: string;
  hostname: string;
  username: string;
  needsPassword: boolean;
  needsPassphrase: boolean;
}

interface ConnectionSecretPromptState {
  pendingRequest?: ConnectionSecretPromptRequest;
  resolveRequest?: (accepted: boolean) => void;
  openPrompt: (request: ConnectionSecretPromptRequest) => Promise<boolean>;
  clearPrompt: (accepted: boolean) => void;
}

let activePromptKey: string | undefined;
let activePromptPromise: Promise<boolean> | undefined;

function getPromptKey(request: ConnectionSecretPromptRequest) {
  return [
    request.actionLabel,
    request.hostId,
    request.needsPassword ? "password" : "",
    request.needsPassphrase ? "passphrase" : "",
  ].join(":");
}

export const useConnectionSecretPromptStore = create<ConnectionSecretPromptState>((set, get) => ({
  pendingRequest: undefined,
  resolveRequest: undefined,
  openPrompt: async (request) => {
    const promptKey = getPromptKey(request);

    if (activePromptPromise && activePromptKey === promptKey) {
      return activePromptPromise;
    }

    if (activePromptPromise) {
      return false;
    }

    activePromptKey = promptKey;
    activePromptPromise = new Promise<boolean>((resolve) => {
      set({
        pendingRequest: request,
        resolveRequest: (accepted) => {
          resolve(accepted);
        },
      });
    });

    const result = await activePromptPromise;
    activePromptKey = undefined;
    activePromptPromise = undefined;
    return result;
  },
  clearPrompt: (accepted) => {
    get().resolveRequest?.(accepted);
    set({
      pendingRequest: undefined,
      resolveRequest: undefined,
    });
  },
}));

