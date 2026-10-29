// @vitest-environment happy-dom
//
// #454: the page is mounted for real (not rendered to markup) so the editor
// controls, the run action and the disabled states are exercised the way a
// person meets them. The two stores the page reads are the real ones, seeded
// per test, so the run action goes through the shared dispatch helper.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useHostsStore } from "../store/hosts-store";
import { useRunbooksStore } from "../store/runbooks-store";
import { openSessionWorkspace, useSessionsStore } from "../store/sessions-store";
import { sampleHosts } from "../types/host";
import { RunbooksPage } from "./RunbooksPage";

function renderRunbooksPage(entry: string) {
  return render(
    createElement(MemoryRouter, { initialEntries: [entry] }, createElement(RunbooksPage))
  );
}

beforeEach(async () => {
  // The persisted stores rehydrate asynchronously when they are created; let
  // that settle before the test seeds them.
  await new Promise((resolve) => setTimeout(resolve, 0));

  useRunbooksStore.setState({ runbooks: [] });
  useSessionsStore.setState({ tabs: [], panes: {}, activeTabId: undefined });
  useHostsStore.setState({ hosts: sampleHosts });
});

afterEach(() => {
  cleanup();
  useRunbooksStore.setState({ runbooks: [] });
  useSessionsStore.setState({ tabs: [], panes: {}, activeTabId: undefined });
});

describe("#454 RunbooksPage", () => {
  it("#454: renders a runbook with its steps and the run, reset, edit and delete actions", () => {
    useRunbooksStore.getState().createRunbook({
      name: "Nightly checks",
      description: "Checks to run at night",
      steps: "uptime\ndf -h\nfree -m",
    });

    renderRunbooksPage("/runbooks");

    expect(screen.getByRole("heading", { name: "Nightly checks" })).toBeTruthy();
    expect(screen.getByText("uptime")).toBeTruthy();
    expect(screen.getByText("df -h")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run next step" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reorder step 1 up" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reorder step 1 down" })).toBeTruthy();
  });

  it("#454: marks the step the runbook is on as the current step", () => {
    useRunbooksStore.getState().createRunbook({
      name: "Nightly checks",
      steps: "uptime\ndf -h\nfree -m",
    });
    useRunbooksStore.setState({
      runbooks: useRunbooksStore
        .getState()
        .runbooks.map((runbook) => ({ ...runbook, nextStepIndex: 1 })),
    });

    renderRunbooksPage("/runbooks");

    const steps = screen.getByRole("list", { name: "Runbook steps" });
    const current = steps.querySelector('[aria-current="step"]');

    expect(current?.textContent).toContain("df -h");
    expect(within(steps).getByText("Current step")).toBeTruthy();
    expect(screen.getByText("Step 2 of 3 is next.")).toBeTruthy();
  });

  it("#454: preselects the runbook the id query parameter names", () => {
    const chosen = useRunbooksStore
      .getState()
      .createRunbook({ name: "Chosen runbook", steps: "one\ntwo\nthree" });
    useRunbooksStore
      .getState()
      .createRunbook({ name: "Other runbook", steps: "one\ntwo\nthree" });

    renderRunbooksPage(`/runbooks?id=${chosen}`);

    expect(screen.getByRole("heading", { name: "Chosen runbook" })).toBeTruthy();
    expect(screen.getByText("Step 1 of 3 is next.")).toBeTruthy();
    expect(screen.queryByText("Every step has been queued.")).toBeNull();
  });

  it("#454: disables the run action when there is no active pane", () => {
    useRunbooksStore.getState().createRunbook({ name: "Nightly checks", steps: "uptime" });

    renderRunbooksPage("/runbooks");

    const runAction = screen.getByRole("button", { name: "Run next step" }) as HTMLButtonElement;
    expect(runAction.disabled).toBe(true);
  });

  it("#454: enables the run action when a session pane is active", () => {
    useRunbooksStore.getState().createRunbook({ name: "Nightly checks", steps: "uptime" });
    useSessionsStore.setState(
      openSessionWorkspace(
        { tabs: [], panes: {}, activeTabId: undefined, lastRestoredAt: undefined },
        sampleHosts[0]
      )
    );

    renderRunbooksPage("/runbooks");

    const runAction = screen.getByRole("button", { name: "Run next step" }) as HTMLButtonElement;
    expect(runAction.disabled).toBe(false);
  });

  it("#454: the editor adds, removes and moves one step without retyping the runbook", () => {
    const runbookId = useRunbooksStore
      .getState()
      .createRunbook({ name: "Nightly checks", steps: "uptime\ndf -h\nfree -m" });

    renderRunbooksPage("/runbooks");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = screen.getByRole("list", { name: "Runbook steps editor" });
    const stepValues = () =>
      within(editor)
        .getAllByLabelText(/^Step \d+ command$/)
        .map((input) => (input as HTMLInputElement).value);

    expect(stepValues()).toEqual(["uptime", "df -h", "free -m"]);

    // A step is added on its own, at the end of the list.
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    expect(stepValues()).toEqual(["uptime", "df -h", "free -m", ""]);

    // The second step is removed; the other commands keep their order.
    fireEvent.click(within(editor).getByRole("button", { name: "Remove step 2" }));
    expect(stepValues()).toEqual(["uptime", "free -m", ""]);

    // The last step moves up one place.
    fireEvent.click(within(editor).getByRole("button", { name: "Move step 3 up" }));
    expect(stepValues()).toEqual(["uptime", "", "free -m"]);

    fireEvent.click(screen.getByRole("button", { name: "Save runbook" }));

    // The empty step is dropped when the runbook is saved.
    const stored = useRunbooksStore.getState().runbooks.find((entry) => entry.id === runbookId);
    expect(stored?.steps).toEqual(["uptime", "free -m"]);
    expect(stored?.name).toBe("Nightly checks");
  });

  it("#454: running the next step queues the command into the active pane and advances the cursor", () => {
    const runbookId = useRunbooksStore
      .getState()
      .createRunbook({ name: "Nightly checks", steps: "uptime\ndf -h" });
    useSessionsStore.setState(
      openSessionWorkspace(
        { tabs: [], panes: {}, activeTabId: undefined, lastRestoredAt: undefined },
        sampleHosts[0]
      )
    );

    renderRunbooksPage("/runbooks");

    fireEvent.click(screen.getByRole("button", { name: "Run next step" }));

    const paneId = useSessionsStore.getState().tabs[0]?.activePaneId ?? "";
    const queued = useSessionsStore.getState().panes[paneId]?.queuedCommands ?? [];

    expect(queued).toHaveLength(1);
    expect(queued[0]?.command).toBe("uptime");
    expect(queued[0]?.label).toBe("Nightly checks");

    const stored = useRunbooksStore.getState().runbooks.find((entry) => entry.id === runbookId);
    expect(stored?.nextStepIndex).toBe(1);
    expect(stored?.lastRunAt).toBeTruthy();
    expect(screen.getByText("Queued step 1 of 2.")).toBeTruthy();
  });
});
