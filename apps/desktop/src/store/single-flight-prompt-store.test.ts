import { describe, expect, it } from "vitest";
import { createSingleFlightPromptStore } from "./single-flight-prompt-store";

describe("single-flight prompt store", () => {
  it("deduplicates identical prompts and rejects concurrent different prompts", async () => {
    const store = createSingleFlightPromptStore<{ id: string }, boolean>({
      busyResult: false,
      getPromptKey: (request) => request.id,
    });

    const first = store.getState().openPrompt({ id: "same" });
    const second = store.getState().openPrompt({ id: "same" });
    const other = store.getState().openPrompt({ id: "other" });

    await expect(other).resolves.toBe(false);
    expect(store.getState().pendingRequest).toEqual({ id: "same" });

    store.getState().clearPrompt(true);

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(store.getState().pendingRequest).toBeUndefined();
  });
});
