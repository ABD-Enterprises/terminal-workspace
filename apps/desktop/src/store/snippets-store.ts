import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createTermsnipStorage } from "../lib/persistence";
import { cancelUndoWindow, expireUndoWindowNow, startUndoWindow } from "../lib/undo-delete";
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

// UX-13: undoable delete. The record is removed from the list immediately
// and stashed here until the undo window expires. On expiry (or replacement
// by a newer delete) the stash drops for good; Undo restores it. The vault
// tombstone is written at delete time and cleared on undo.
const UNDO_WINDOW_KEY = "snippets:delete";
const UNDO_WINDOW_MS = 5_000;

interface SnippetsState {
  snippets: SnippetRecord[];
  /** Record removed by the most recent delete, pending expiry or undo. */
  pendingDeletedSnippet?: SnippetRecord;
  createSnippet: (values: SnippetFormValues) => string;
  updateSnippet: (snippetId: string, values: SnippetFormValues) => string;
  deleteSnippet: (snippetId: string) => void;
  restoreDeletedSnippet: () => void;
  duplicateSnippet: (snippetId: string) => string;
  markSnippetRun: (snippetId: string) => void;
  removeHostFromAllTargets: (hostId: string) => void;
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
      // UX-13: soft delete. The record leaves the list immediately (every
      // consumer keeps working unchanged) and is stashed until the undo
      // window expires. A second delete while one is pending expires the
      // first window so its record is never silently resurrectable.
      deleteSnippet: (snippetId) => {
        const stash = get().snippets.find((snippet) => snippet.id === snippetId);
        if (!stash) {
          return;
        }

        expireUndoWindowNow(UNDO_WINDOW_KEY, () => {
          set({ pendingDeletedSnippet: undefined });
        });
        useVaultSyncStore.getState().markDeleted("snippets", snippetId);
        set((state) => ({
          pendingDeletedSnippet: stash,
          snippets: sortSnippets(state.snippets.filter((snippet) => snippet.id !== snippetId)),
        }));
        startUndoWindow(UNDO_WINDOW_KEY, UNDO_WINDOW_MS, () => {
          set({ pendingDeletedSnippet: undefined });
        });
      },
      restoreDeletedSnippet: () => {
        const stash = get().pendingDeletedSnippet;
        if (!stash) {
          return;
        }
        cancelUndoWindow(UNDO_WINDOW_KEY);
        useVaultSyncStore.getState().clearDeleted("snippets", stash.id);
        set((state) => ({
          pendingDeletedSnippet: undefined,
          snippets: sortSnippets([...state.snippets, stash]),
        }));
      },
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
      removeHostFromAllTargets: (hostId) =>
        set((state) => ({
          snippets: sortSnippets(
            state.snippets.map((snippet) => ({
              ...snippet,
              targetHostIds: snippet.targetHostIds.filter((id) => id !== hostId),
            }))
          ),
        })),
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
      // UX-13: the undo stash is session-only; a persisted stash would
      // outlive the window it belongs to.
      partialize: (state) => ({ snippets: state.snippets }),
    }
  )
);
