import { create } from "zustand";

export interface SingleFlightPromptState<TRequest, TResult> {
  pendingRequest?: TRequest;
  resolveRequest?: (accepted: TResult) => void;
  openPrompt: (request: TRequest) => Promise<TResult>;
  clearPrompt: (accepted: TResult) => void;
}

interface SingleFlightPromptOptions<TRequest, TResult> {
  busyResult: TResult;
  getPromptKey: (request: TRequest) => string;
}

export function createSingleFlightPromptStore<TRequest, TResult>({
  busyResult,
  getPromptKey,
}: SingleFlightPromptOptions<TRequest, TResult>) {
  let activePromptKey: string | undefined;
  let activePromptPromise: Promise<TResult> | undefined;

  return create<SingleFlightPromptState<TRequest, TResult>>((set, get) => ({
    pendingRequest: undefined,
    resolveRequest: undefined,
    openPrompt: async (request) => {
      const promptKey = getPromptKey(request);

      if (activePromptPromise && activePromptKey === promptKey) {
        return activePromptPromise;
      }

      if (activePromptPromise) {
        return busyResult;
      }

      activePromptKey = promptKey;
      activePromptPromise = new Promise<TResult>((resolve) => {
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
}
