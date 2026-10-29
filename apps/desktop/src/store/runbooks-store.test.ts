import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/active-pane-dispatch", () => ({
  dispatchCommandToActivePane: vi.fn(() => true),
}));

import { dispatchCommandToActivePane } from "../lib/active-pane-dispatch";
import { useRunbooksStore } from "./runbooks-store";

const mockedDispatch = vi.mocked(dispatchCommandToActivePane);

describe("#454 runbooks store", () => {
  beforeEach(() => {
    useRunbooksStore.setState({ runbooks: [] });
    mockedDispatch.mockReturnValue(true);
  });

  it("#454: creating a runbook stores a clamped record and returns its id", () => {
    const id = useRunbooksStore
      .getState()
      .createRunbook({ name: "Nightly", description: "", steps: "uptime\ndf -h" });

    const stored = useRunbooksStore.getState().runbooks.find((entry) => entry.id === id);
    expect(stored?.steps).toEqual(["uptime", "df -h"]);
    expect(stored?.nextStepIndex).toBe(0);
  });

  it("#454: runNextStep dispatches exactly the current step through dispatchCommandToActivePane", () => {
    const id = useRunbooksStore
      .getState()
      .createRunbook({ name: "Nightly", description: "", steps: "uptime\ndf -h" });

    expect(useRunbooksStore.getState().runNextStep(id)).toBe(true);
    expect(mockedDispatch).toHaveBeenCalledWith("uptime", "Nightly");

    const stored = useRunbooksStore.getState().runbooks.find((entry) => entry.id === id);
    expect(stored?.nextStepIndex).toBe(1);
    expect(stored?.lastRunAt).toBeTruthy();
  });

  it("#454: runNextStep returns false at the end of the runbook without dispatching", () => {
    const id = useRunbooksStore.getState().createRunbook({ name: "One", steps: "uptime" });
    mockedDispatch.mockReturnValueOnce(true);
    expect(useRunbooksStore.getState().runNextStep(id)).toBe(true);

    mockedDispatch.mockClear();
    expect(useRunbooksStore.getState().runNextStep(id)).toBe(false);
    expect(mockedDispatch).not.toHaveBeenCalled();
  });

  it("#454: runNextStep returns false and advances nothing when no pane is active", () => {
    const id = useRunbooksStore.getState().createRunbook({ name: "One", steps: "uptime" });
    mockedDispatch.mockReturnValue(false);

    expect(useRunbooksStore.getState().runNextStep(id)).toBe(false);
    const stored = useRunbooksStore.getState().runbooks.find((entry) => entry.id === id);
    expect(stored?.nextStepIndex).toBe(0);
    expect(stored?.lastRunAt).toBeUndefined();
  });

  it("#454: resetRunbook returns the cursor to zero", () => {
    const id = useRunbooksStore.getState().createRunbook({ name: "One", steps: "uptime\ndf" });
    useRunbooksStore.getState().runNextStep(id);
    useRunbooksStore.getState().resetRunbook(id);

    const stored = useRunbooksStore.getState().runbooks.find((entry) => entry.id === id);
    expect(stored?.nextStepIndex).toBe(0);
  });

  it("#454: reorderRunbookSteps moves a step and ignores out-of-range indices", () => {
    const id = useRunbooksStore
      .getState()
      .createRunbook({ name: "R", steps: "one\ntwo\nthree" });
    useRunbooksStore.getState().reorderRunbookSteps(id, 2, 0);

    const stored = useRunbooksStore.getState().runbooks.find((entry) => entry.id === id);
    expect(stored?.steps).toEqual(["three", "one", "two"]);

    useRunbooksStore.getState().reorderRunbookSteps(id, 0, 99);
    expect(
      useRunbooksStore.getState().runbooks.find((entry) => entry.id === id)?.steps
    ).toEqual(["three", "one", "two"]);
  });
});
