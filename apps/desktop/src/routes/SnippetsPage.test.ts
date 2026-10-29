// @vitest-environment happy-dom
//
// #454: the "Create runbook from command" action is exercised through the
// real page — the button is clicked and the navigation it triggers is
// observed — so the wiring (and not only the store behind it) is covered.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useEffect } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useRunbooksStore } from "../store/runbooks-store";
import { useSnippetsStore } from "../store/snippets-store";
import { sampleSnippets } from "../types/snippet";
import { SnippetsPage } from "./SnippetsPage";

function LocationProbe({ onChange }: { onChange: (path: string) => void }) {
  const location = useLocation();

  useEffect(() => {
    onChange(`${location.pathname}${location.search}`);
  }, [location, onChange]);

  return null;
}

describe("#454 snippets page", () => {
  let currentPath = "";

  const recordPath = (path: string) => {
    currentPath = path;
  };

  beforeEach(async () => {
    // The persisted stores rehydrate asynchronously when they are created.
    // Let that settle before the test seeds them, so the page reads the
    // seeded state and not the persisted one.
    await new Promise((resolve) => setTimeout(resolve, 0));

    currentPath = "";
    useSnippetsStore.setState({ snippets: [...sampleSnippets] });
    useRunbooksStore.setState({ runbooks: [] });
  });

  afterEach(() => {
    cleanup();
    useSnippetsStore.setState({ snippets: [] });
    useRunbooksStore.setState({ runbooks: [] });
  });

  it("imports successfully", async () => {
    const mod = await import("./SnippetsPage");
    expect(mod).toBeDefined();
  });

  it("#454: creates a one-step runbook from the selected command and opens it", () => {
    render(
      createElement(
        MemoryRouter,
        { initialEntries: ["/snippets"] },
        createElement(LocationProbe, { onChange: recordPath }),
        createElement(SnippetsPage)
      )
    );

    const snippet = sampleSnippets[0];

    fireEvent.click(screen.getByRole("button", { name: "Create runbook from command" }));

    const runbooks = useRunbooksStore.getState().runbooks;
    expect(runbooks).toHaveLength(1);

    const runbook = runbooks[0];
    expect(runbook.name).toBe(snippet.title);
    expect(runbook.description).toBe(snippet.description);
    expect(runbook.steps).toEqual([snippet.command]);
    expect(runbook.nextStepIndex).toBe(0);
    expect(currentPath).toBe(`/runbooks?id=${runbook.id}`);
  });
});
