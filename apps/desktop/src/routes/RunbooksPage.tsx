import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ConfirmDialog } from "../components/common/ConfirmDialog";
import { formatRelativeTime } from "../lib/utils";
import { useRunbooksStore } from "../store/runbooks-store";
import { useSessionsStore } from "../store/sessions-store";
import {
  emptyRunbookFormValues,
  runbookToFormValues,
  type RunbookFormValues,
  type RunbookRecord,
} from "../types/runbook";

const secondaryButtonClass =
  "rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";

const primaryButtonClass =
  "rounded-lg bg-emerald-400 px-3 py-1.5 text-sm font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40";

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20";

const stepInputClass =
  "min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 font-mono text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20";

const stepButtonClass =
  "rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40";

export function RunbooksPage() {
  const [searchParams] = useSearchParams();
  const requestedRunbookId = searchParams.get("id");

  const runbooks = useRunbooksStore((state) => state.runbooks);
  const createRunbook = useRunbooksStore((state) => state.createRunbook);
  const updateRunbook = useRunbooksStore((state) => state.updateRunbook);
  const reorderRunbookSteps = useRunbooksStore((state) => state.reorderRunbookSteps);
  const deleteRunbook = useRunbooksStore((state) => state.deleteRunbook);
  const runNextStep = useRunbooksStore((state) => state.runNextStep);
  const resetRunbook = useRunbooksStore((state) => state.resetRunbook);

  const activeTabId = useSessionsStore((state) => state.activeTabId);
  const tabs = useSessionsStore((state) => state.tabs);
  const panes = useSessionsStore((state) => state.panes);

  // #454: the same rule the shared dispatch helper uses — the active tab is
  // the one `activeTabId` names, and a runbook can only run into its pane.
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activePane = activeTab ? panes[activeTab.activePaneId] : undefined;

  // #454: the editor keeps the steps as an ordered list, not as one blob of
  // text, so a single command can be added, changed, removed or moved
  // without retyping the other steps around it.
  const [name, setName] = useState(emptyRunbookFormValues.name);
  const [description, setDescription] = useState(emptyRunbookFormValues.description ?? "");
  const [stepLines, setStepLines] = useState<string[]>([]);
  const [editingRunbookId, setEditingRunbookId] = useState<string>();
  const [selectedRunbookId, setSelectedRunbookId] = useState<string>();
  const [deletePendingId, setDeletePendingId] = useState<string>();
  const [runStatus, setRunStatus] = useState<string>();

  const selectedRunbook =
    runbooks.find((runbook) => runbook.id === selectedRunbookId) ??
    runbooks.find((runbook) => runbook.id === requestedRunbookId) ??
    runbooks[0];

  const runbookFinished = Boolean(
    selectedRunbook && selectedRunbook.nextStepIndex >= selectedRunbook.steps.length
  );

  const resetEditor = () => {
    setName(emptyRunbookFormValues.name);
    setDescription(emptyRunbookFormValues.description ?? "");
    setStepLines([]);
  };

  const addStep = () => {
    setStepLines((current) => [...current, ""]);
  };

  const updateStep = (index: number, value: string) => {
    setStepLines((current) =>
      current.map((step, stepIndex) => (stepIndex === index ? value : step))
    );
  };

  const removeStep = (index: number) => {
    setStepLines((current) => current.filter((_, stepIndex) => stepIndex !== index));
  };

  const moveStep = (index: number, offset: number) => {
    setStepLines((current) => {
      const target = index + offset;

      // Out-of-range moves are a no-op, the same rule the store applies.
      if (target < 0 || target >= current.length) {
        return current;
      }

      const next = [...current];
      const [moved] = next.splice(index, 1);

      if (moved === undefined) {
        return current;
      }

      next.splice(target, 0, moved);
      return next;
    });
  };

  const submitForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const values: RunbookFormValues = {
      name,
      description,
      steps: stepLines.join("\n"),
    };

    const runbookId = editingRunbookId
      ? updateRunbook(editingRunbookId, values)
      : createRunbook(values);

    setSelectedRunbookId(runbookId);
    setEditingRunbookId(undefined);
    resetEditor();
    setRunStatus(undefined);
  };

  const startEditing = (runbook: RunbookRecord) => {
    const values = runbookToFormValues(runbook);

    setEditingRunbookId(runbook.id);
    setSelectedRunbookId(runbook.id);
    setName(values.name);
    setDescription(values.description ?? "");
    setStepLines(values.steps.length ? values.steps.split("\n") : []);
    setRunStatus(undefined);
  };

  const cancelEditing = () => {
    setEditingRunbookId(undefined);
    resetEditor();
  };

  // #454: the page asks the store to run the next step; the store owns the
  // dispatch, so the command lands in the pane the person has open without
  // this page knowing anything about panes.
  const handleRunNextStep = () => {
    if (!selectedRunbook) {
      return;
    }

    const stepNumber = selectedRunbook.nextStepIndex + 1;
    const stepCount = selectedRunbook.steps.length;

    if (!runNextStep(selectedRunbook.id)) {
      setRunStatus("Nothing was queued: open a session pane, or reset the runbook.");
      return;
    }

    setRunStatus(`Queued step ${stepNumber} of ${stepCount}.`);
  };

  const handleReset = () => {
    if (!selectedRunbook) {
      return;
    }

    resetRunbook(selectedRunbook.id);
    setRunStatus("Runbook reset to the first step.");
  };

  const handleDelete = () => {
    if (!deletePendingId) {
      return;
    }

    deleteRunbook(deletePendingId);

    if (selectedRunbook?.id === deletePendingId) {
      setSelectedRunbookId(undefined);
    }

    if (editingRunbookId === deletePendingId) {
      cancelEditing();
    }

    setDeletePendingId(undefined);
  };

  return (
    <>
      <section className="flex h-full min-h-0 flex-col gap-3">
        <div className="rounded-[22px] border border-slate-800/80 bg-slate-950/45 px-4 py-3">
          <p className="text-sm text-slate-400">
            {runbooks.length} runbooks • ordered command steps, run one at a time into the active
            session pane
          </p>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            <form
              onSubmit={submitForm}
              className="rounded-[18px] border border-slate-800 bg-slate-900/60 p-3"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {editingRunbookId ? "Edit runbook" : "New runbook"}
              </p>

              <label className="mt-2 block text-xs text-slate-400" htmlFor="runbook-name">
                Name
              </label>
              <input
                id="runbook-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Nightly checks"
                className={inputClass}
              />

              <label className="mt-2 block text-xs text-slate-400" htmlFor="runbook-description">
                Description
              </label>
              <input
                id="runbook-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What this runbook is for"
                className={inputClass}
              />

              <p className="mt-2 text-xs text-slate-400">Steps</p>
              {/* #454: one field per step, so a single command can be added,
                  changed, removed or moved on its own. */}
              <ol aria-label="Runbook steps editor" className="mt-1 space-y-1.5">
                {stepLines.map((step, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-center text-[11px] text-slate-500">
                      {index + 1}
                    </span>
                    <input
                      value={step}
                      aria-label={`Step ${index + 1} command`}
                      onChange={(event) => updateStep(index, event.target.value)}
                      placeholder="uptime"
                      className={stepInputClass}
                    />
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        aria-label={`Move step ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() => moveStep(index, -1)}
                        className={stepButtonClass}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        aria-label={`Move step ${index + 1} down`}
                        disabled={index === stepLines.length - 1}
                        onClick={() => moveStep(index, 1)}
                        className={stepButtonClass}
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove step ${index + 1}`}
                        onClick={() => removeStep(index)}
                        className={stepButtonClass}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-1 text-[11px] text-slate-500">
                {stepLines.length
                  ? "Steps run from the top down. Empty steps are dropped when the runbook is saved."
                  : "No steps yet. Add the commands to run, one per step."}
              </p>
              <button type="button" onClick={addStep} className={`${secondaryButtonClass} mt-2`}>
                Add step
              </button>

              <div className="mt-3 flex flex-wrap gap-2">
                <button type="submit" className={primaryButtonClass}>
                  {editingRunbookId ? "Save runbook" : "Create runbook"}
                </button>
                {editingRunbookId ? (
                  <button type="button" onClick={cancelEditing} className={secondaryButtonClass}>
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>

            {runbooks.length ? (
              <ul className="space-y-2">
                {runbooks.map((runbook) => {
                  const isSelected = selectedRunbook?.id === runbook.id;
                  const finished = runbook.nextStepIndex >= runbook.steps.length;

                  return (
                    <li key={runbook.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRunbookId(runbook.id);
                          setRunStatus(undefined);
                        }}
                        className={`w-full rounded-[14px] border px-3 py-2 text-left transition ${
                          isSelected
                            ? "border-emerald-400/50 bg-emerald-400/10"
                            : "border-slate-800 bg-slate-950/60 hover:border-slate-600"
                        }`}
                      >
                        <span className="block truncate text-sm font-medium text-slate-100">
                          {runbook.name}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-slate-500">
                          {runbook.steps.length} steps •{" "}
                          {finished
                            ? "complete"
                            : `next step ${runbook.nextStepIndex + 1} of ${runbook.steps.length}`}{" "}
                          • updated {formatRelativeTime(runbook.updatedAt)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="rounded-[18px] border border-slate-800 bg-slate-900/60 p-3 text-sm text-slate-400">
                No runbooks yet. Create one above, or turn a saved snippet into a runbook from the
                snippets page.
              </p>
            )}
          </div>

          <div className="min-h-0 overflow-y-auto rounded-[18px] border border-slate-800 bg-slate-900/60 p-3">
            {selectedRunbook ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Runbook details
                    </p>
                    <h3 className="mt-1.5 text-lg font-semibold text-slate-50">
                      {selectedRunbook.name}
                    </h3>
                    {selectedRunbook.description ? (
                      <p className="mt-1 text-sm text-slate-400">{selectedRunbook.description}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => startEditing(selectedRunbook)}
                      className={secondaryButtonClass}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={!activePane || runbookFinished}
                      onClick={handleRunNextStep}
                      className={primaryButtonClass}
                    >
                      Run next step
                    </button>
                    <button
                      type="button"
                      disabled={selectedRunbook.nextStepIndex === 0}
                      onClick={handleReset}
                      className={secondaryButtonClass}
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletePendingId(selectedRunbook.id)}
                      className={secondaryButtonClass}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {runStatus ? <p className="mt-2 text-xs text-slate-400">{runStatus}</p> : null}

                <p className="mt-3 text-[11px] text-slate-500">
                  {selectedRunbook.steps.length
                    ? runbookFinished
                      ? "Every step has been queued. Reset to run the runbook again."
                      : `Step ${selectedRunbook.nextStepIndex + 1} of ${
                          selectedRunbook.steps.length
                        } is next.`
                    : "This runbook has no steps yet. Edit it to add the commands to run."}
                </p>

                <ol aria-label="Runbook steps" className="mt-2 space-y-2">
                  {selectedRunbook.steps.map((step, index) => {
                    const isCurrent = index === selectedRunbook.nextStepIndex;

                    return (
                      <li
                        key={`${index}-${step}`}
                        aria-current={isCurrent ? "step" : undefined}
                        className={`flex items-start gap-3 rounded-[14px] border px-3 py-2 ${
                          isCurrent
                            ? "border-emerald-400/50 bg-emerald-400/10"
                            : "border-slate-800 bg-slate-950/60"
                        }`}
                      >
                        <span className="mt-0.5 w-6 shrink-0 text-center text-xs text-slate-500">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <code className="block break-words text-xs leading-5 text-emerald-200">
                            {step}
                          </code>
                          {isCurrent ? (
                            <span className="mt-1 inline-block rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-emerald-200">
                              Current step
                            </span>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-col gap-1">
                          <button
                            type="button"
                            aria-label={`Reorder step ${index + 1} up`}
                            disabled={index === 0}
                            onClick={() =>
                              reorderRunbookSteps(selectedRunbook.id, index, index - 1)
                            }
                            className={stepButtonClass}
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            aria-label={`Reorder step ${index + 1} down`}
                            disabled={index === selectedRunbook.steps.length - 1}
                            onClick={() =>
                              reorderRunbookSteps(selectedRunbook.id, index, index + 1)
                            }
                            className={stepButtonClass}
                          >
                            Down
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </>
            ) : (
              <p className="text-sm text-slate-400">
                Select a runbook to see its steps, or create one on the left.
              </p>
            )}
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(deletePendingId)}
        title="Delete runbook"
        description="Delete this runbook from the local runbook library?"
        confirmLabel="Delete"
        onCancel={() => setDeletePendingId(undefined)}
        onConfirm={handleDelete}
      />
    </>
  );
}
