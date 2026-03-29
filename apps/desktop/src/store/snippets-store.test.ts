import { describe, expect, it } from "vitest";
import { emptySnippetFormValues } from "../types/snippet";
import { useSnippetsStore } from "./snippets-store";

describe("snippets store", () => {
  it("creates, updates, duplicates, and deletes snippets", () => {
    const initialCount = useSnippetsStore.getState().snippets.length;

    const snippetId = useSnippetsStore.getState().createSnippet({
      ...emptySnippetFormValues,
      title: "Check uptime",
      command: "uptime",
      tags: "ops, quick",
      targetHostIds: ["billing-api"],
    });

    expect(useSnippetsStore.getState().snippets).toHaveLength(initialCount + 1);

    useSnippetsStore.getState().updateSnippet(snippetId, {
      ...emptySnippetFormValues,
      title: "Check uptime and memory",
      command: "uptime && free -m",
      tags: "ops",
      targetHostIds: ["billing-api", "prod-gateway"],
    });

    const updated = useSnippetsStore.getState().snippets.find((snippet) => snippet.id === snippetId);
    expect(updated?.title).toBe("Check uptime and memory");
    expect(updated?.targetHostIds).toHaveLength(2);

    const duplicateId = useSnippetsStore.getState().duplicateSnippet(snippetId);
    expect(duplicateId).not.toBe(snippetId);

    useSnippetsStore.getState().deleteSnippet(snippetId);
    useSnippetsStore.getState().deleteSnippet(duplicateId);
    expect(useSnippetsStore.getState().snippets).toHaveLength(initialCount);
  });
});
