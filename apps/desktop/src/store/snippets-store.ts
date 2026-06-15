import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createTermsnipStorage } from "../lib/persistence";
import {
  createSnippetRecord,
  sampleSnippets,
  type SnippetFormValues,
  type SnippetRecord,
} from "../types/snippet";
import { useVaultSyncStore } from "./vault-sync-store";

function sortSnippets(snippets: SnippetRecord[]) {
  return [...snippets].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

interface SnippetsState {
  snippets: SnippetRecord[];
  createSnippet: (values: SnippetFormValues) => string;
  updateSnippet: (snippetId: string, values: SnippetFormValues) => string;
  deleteSnippet: (snippetId: string) => void;
  duplicateSnippet: (snippetId: string) => string;
  markSnippetRun: (snippetId: string) => void;
}

export const useSnippetsStore = create<SnippetsState>()(
  persist(
    (set, get) => ({
      snippets: sortSnippets(sampleSnippets),
      createSnippet: (values) => {
        const snippet = createSnippetRecord(values);
        set((state) => ({
          snippets: sortSnippets([...state.snippets, snippet]),
        }));
        useVaultSyncStore.getState().clearDeleted("snippets", snippet.id);
        return snippet.id;
      },
      updateSnippet: (snippetId, values) => {
        set((state) => ({
          snippets: sortSnippets(
            state.snippets.map((snippet) =>
              snippet.id === snippetId ? createSnippetRecord(values, snippet) : snippet
            )
          ),
        }));
        useVaultSyncStore.getState().clearDeleted("snippets", snippetId);
        return snippetId;
      },
      deleteSnippet: (snippetId) =>
        set((state) => {
          useVaultSyncStore.getState().markDeleted("snippets", snippetId);
          return {
            snippets: sortSnippets(state.snippets.filter((snippet) => snippet.id !== snippetId)),
          };
        }),
      duplicateSnippet: (snippetId) => {
        const source = get().snippets.find((snippet) => snippet.id === snippetId);
        if (!source) {
          return "";
        }

        const snippet = {
          ...createSnippetRecord(
            {
              title: `${source.title} Copy`,
              description: source.description,
              command: source.command,
              tags: source.tags.join(", "),
              targetHostIds: source.targetHostIds,
            },
            undefined
          ),
          lastRunAt: undefined,
        };

        set((state) => ({
          snippets: sortSnippets([snippet, ...state.snippets]),
        }));
        useVaultSyncStore.getState().clearDeleted("snippets", snippet.id);

        return snippet.id;
      },
      markSnippetRun: (snippetId) =>
        set((state) => ({
          snippets: sortSnippets(
            state.snippets.map((snippet) =>
              snippet.id === snippetId
                ? {
                    ...snippet,
                    lastRunAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  }
                : snippet
            )
          ),
        })),
    }),
    {
      name: "terminal-workspace-snippets",
      storage: createJSONStorage(() => createTermsnipStorage("terminal-workspace-snippets")),
    }
  )
);
