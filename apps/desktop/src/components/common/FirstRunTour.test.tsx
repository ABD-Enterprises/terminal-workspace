// @vitest-environment happy-dom
//
// Route-dismissal contract for the first-run tour. The tour is a
// bottom-right toast that overlapped the Sessions page's QUICK CONNECT
// rail, so it now dismisses on the first real route change — with one
// exception: the index route's "/" → "/hosts" startup redirect fires
// while the shell is still booting and must not kill the tour instantly.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Fragment, createElement } from "react";
import {
  MemoryRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../store/app-store";
import { FirstRunTour } from "./FirstRunTour";

const tourName = "First-run tour";

function Shell() {
  const navigate = useNavigate();
  return createElement(
    Fragment,
    null,
    createElement(Outlet),
    createElement(FirstRunTour),
    createElement(
      "button",
      { type: "button", onClick: () => navigate("/sessions") },
      "Go to sessions"
    )
  );
}

function renderTourApp(initialEntry: string) {
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: [initialEntry] },
      createElement(
        Routes,
        null,
        createElement(
          Route,
          { path: "/", element: createElement(Shell) },
          createElement(Route, {
            index: true,
            element: createElement(Navigate, { to: "/hosts", replace: true }),
          }),
          createElement(Route, {
            path: "hosts",
            element: createElement("p", null, "Hosts page"),
          }),
          createElement(Route, {
            path: "sessions",
            element: createElement("p", null, "Sessions page"),
          })
        )
      )
    )
  );
}

beforeEach(() => {
  useAppStore.setState({ sawFirstRunTour: false });
});

afterEach(() => {
  cleanup();
  useAppStore.setState({ sawFirstRunTour: false });
});

describe("FirstRunTour route dismissal", () => {
  it("survives the startup redirect from / to /hosts", () => {
    renderTourApp("/");

    // The index route redirected while the shell stayed mounted; that is
    // boot, not navigation, so the tour must still be up.
    expect(useAppStore.getState().sawFirstRunTour).toBe(false);
    expect(screen.getByRole("status", { name: tourName })).toBeTruthy();
  });

  it("dismisses on the first real navigation", () => {
    renderTourApp("/hosts");
    expect(screen.getByRole("status", { name: tourName })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Go to sessions" }));

    expect(useAppStore.getState().sawFirstRunTour).toBe(true);
    expect(screen.queryByRole("status", { name: tourName })).toBeNull();
  });

  it("stays dismissed when the user returns to a previous route", () => {
    renderTourApp("/hosts");
    fireEvent.click(screen.getByRole("button", { name: "Go to sessions" }));
    expect(useAppStore.getState().sawFirstRunTour).toBe(true);

    // A remount (e.g. the shell re-rendering) must not resurrect it.
    renderTourApp("/hosts");
    expect(screen.queryByRole("status", { name: tourName })).toBeNull();
  });
});
