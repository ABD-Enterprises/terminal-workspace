import type { ConnectionSecretPromptRequest } from "./connection-secret-prompt-store";
import { useConnectionSecretPromptStore } from "./connection-secret-prompt-store";

export function requestConnectionSecretsPrompt(request: ConnectionSecretPromptRequest) {
  return useConnectionSecretPromptStore.getState().openPrompt(request);
}

