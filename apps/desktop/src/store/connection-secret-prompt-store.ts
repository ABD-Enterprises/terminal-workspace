import { createSingleFlightPromptStore } from "./single-flight-prompt-store";

export interface ConnectionSecretPromptRequest {
  actionLabel: string;
  hostId: string;
  hostLabel: string;
  hostname: string;
  username: string;
  needsPassword: boolean;
  needsPassphrase: boolean;
}

function getPromptKey(request: ConnectionSecretPromptRequest) {
  return [
    request.actionLabel,
    request.hostId,
    request.needsPassword ? "password" : "",
    request.needsPassphrase ? "passphrase" : "",
  ].join(":");
}

export const useConnectionSecretPromptStore =
  createSingleFlightPromptStore<ConnectionSecretPromptRequest, boolean>({
    busyResult: false,
    getPromptKey,
  });
