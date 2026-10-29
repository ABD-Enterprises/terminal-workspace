export interface RunbookRecord {
  id: string;
  name: string;
  description?: string;
  /**
   * #454: the ordered commands of the runbook. One command per entry; the
   * person runs them one at a time into the pane they already have open.
   */
  steps: string[];
  /**
   * #454: the index of the step to run next. It never points past the end of
   * `steps` and never before the first step.
   */
  nextStepIndex: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
}

export interface RunbookFormValues {
  name: string;
  description?: string;
  /**
   * #454: the editor holds the steps as newline-separated text — one command
   * per line — and `createRunbookRecord` splits it into the ordered list.
   */
  steps: string;
}

export const emptyRunbookFormValues: RunbookFormValues = {
  name: "",
  description: "",
  steps: "",
};

/**
 * #454: split the editor's newline-separated commands into the runbook's
 * ordered steps. Blank lines are dropped so an empty line never becomes a
 * step the person has to run.
 */
function splitStepLines(steps: string): string[] {
  return steps
    .split("\n")
    .map((step) => step.trim())
    .filter((step) => step.length > 0);
}

export function createRunbookRecord(
  values: RunbookFormValues,
  currentRunbook?: RunbookRecord
): RunbookRecord {
  const now = new Date().toISOString();
  const steps = splitStepLines(values.steps);

  return {
    id: currentRunbook?.id ?? crypto.randomUUID(),
    name: values.name.trim(),
    description: values.description?.trim(),
    steps,
    nextStepIndex: Math.max(
      0,
      Math.min(currentRunbook?.nextStepIndex ?? 0, steps.length)
    ),
    createdAt: currentRunbook?.createdAt ?? now,
    updatedAt: now,
    lastRunAt: currentRunbook?.lastRunAt,
  };
}

export function runbookToFormValues(runbook: RunbookRecord): RunbookFormValues {
  return {
    name: runbook.name,
    description: runbook.description ?? "",
    steps: runbook.steps.join("\n"),
  };
}
