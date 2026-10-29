import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { dispatchCommandToActivePane } from "../lib/active-pane-dispatch";
import { createTermsnipStorage } from "../lib/persistence";
import {
  createRunbookRecord,
  type RunbookFormValues,
  type RunbookRecord,
} from "../types/runbook";
import { useSnippetsStore } from "./snippets-store";

function sortRunbooks(runbooks: RunbookRecord[]) {
  return [...runbooks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export interface RunbooksState {
  runbooks: RunbookRecord[];
  createRunbook: (values: RunbookFormValues) => string;
  updateRunbook: (runbookId: string, values: RunbookFormValues) => string;
  reorderRunbookSteps: (runbookId: string, fromIndex: number, toIndex: number) => void;
  deleteRunbook: (runbookId: string) => void;
  runNextStep: (runbookId: string) => boolean;
  resetRunbook: (runbookId: string) => void;
  createRunbookFromCommand: (snippetId: string) => string | undefined;
}

export const useRunbooksStore = create<RunbooksState>()(
  persist(
    (set, get) => ({
      runbooks: [],
      createRunbook: (values) => {
        const runbook = createRunbookRecord(values);

        set((state) => ({
          runbooks: sortRunbooks([...state.runbooks, runbook]),
        }));

        return runbook.id;
      },
      updateRunbook: (runbookId, values) => {
        set((state) => ({
          runbooks: sortRunbooks(
            state.runbooks.map((runbook) =>
              runbook.id === runbookId ? createRunbookRecord(values, runbook) : runbook
            )
          ),
        }));

        return runbookId;
      },
      reorderRunbookSteps: (runbookId, fromIndex, toIndex) =>
        set((state) => ({
          runbooks: sortRunbooks(
            state.runbooks.map((runbook) => {
              if (runbook.id !== runbookId) {
                return runbook;
              }

              // Out-of-range indices are a no-op: the page disables the
              // buttons that could produce them, and the store stays safe
              // when they are called directly.
              if (
                fromIndex === toIndex ||
                fromIndex < 0 ||
                toIndex < 0 ||
                fromIndex >= runbook.steps.length ||
                toIndex >= runbook.steps.length
              ) {
                return runbook;
              }

              const steps = [...runbook.steps];
              const [moved] = steps.splice(fromIndex, 1);

              if (moved === undefined) {
                return runbook;
              }

              steps.splice(toIndex, 0, moved);

              return { ...runbook, steps, updatedAt: new Date().toISOString() };
            })
          ),
        })),
      deleteRunbook: (runbookId) =>
        set((state) => ({
          runbooks: sortRunbooks(state.runbooks.filter((runbook) => runbook.id !== runbookId)),
        })),
      runNextStep: (runbookId) => {
        const runbook = get().runbooks.find((entry) => entry.id === runbookId);

        // A missing runbook, an empty step list and a finished runbook all
        // mean "there is nothing to run": no dispatch, no cursor movement.
        if (!runbook || !runbook.steps.length || runbook.nextStepIndex >= runbook.steps.length) {
          return false;
        }

        const step = runbook.steps[runbook.nextStepIndex];

        if (step === undefined) {
          return false;
        }

        // #454: the page never dispatches. The store does, through the shared
        // helper, so every surface queues into the same pane by the same rule.
        if (!dispatchCommandToActivePane(step, runbook.name)) {
          return false;
        }

        const now = new Date().toISOString();

        set((state) => ({
          runbooks: sortRunbooks(
            state.runbooks.map((entry) =>
              entry.id === runbookId
                ? {
                    ...entry,
                    nextStepIndex: Math.min(entry.nextStepIndex + 1, entry.steps.length),
                    lastRunAt: now,
                    updatedAt: now,
                  }
                : entry
            )
          ),
        }));

        return true;
      },
      resetRunbook: (runbookId) =>
        set((state) => ({
          runbooks: sortRunbooks(
            state.runbooks.map((runbook) =>
              runbook.id === runbookId
                ? { ...runbook, nextStepIndex: 0, updatedAt: new Date().toISOString() }
                : runbook
            )
          ),
        })),
      createRunbookFromCommand: (snippetId) => {
        const snippet = useSnippetsStore.getState().snippets.find((entry) => entry.id === snippetId);

        if (!snippet) {
          return undefined;
        }

        // #454: the saved command is the runbook's single step, kept verbatim
        // so the runbook runs exactly the command the snippet ran.
        const runbook: RunbookRecord = {
          ...createRunbookRecord({
            name: snippet.title,
            description: snippet.description,
            steps: snippet.command,
          }),
          steps: [snippet.command],
        };

        set((state) => ({
          runbooks: sortRunbooks([...state.runbooks, runbook]),
        }));

        return runbook.id;
      },
    }),
    {
      name: "terminal-workspace-runbooks",
      storage: createJSONStorage(() => createTermsnipStorage("terminal-workspace-runbooks")),
    }
  )
);
