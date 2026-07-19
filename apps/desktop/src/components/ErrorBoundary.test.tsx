import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { ErrorBoundary, ErrorFallback, logUnhandledRejection } from "./ErrorBoundary";

it("renders the recovery UI once a child error has been caught", () => {
  // The suite runs in a node (no-DOM) environment, so we drive the exact two
  // methods React invokes when a descendant throws during render —
  // getDerivedStateFromError to record the error, then render — and assert the
  // result is the recovery UI rather than a blank/thrown tree.
  const instance = new ErrorBoundary({ children: null });
  instance.state = ErrorBoundary.getDerivedStateFromError(new Error("kaboom"));
  const html = renderToStaticMarkup(instance.render() as ReactElement);

  expect(html).toContain("Something went wrong");
  expect(html).toContain("Reload");
  expect(html).toContain('role="alert"');
});

it("passes children through unchanged when no error has occurred", () => {
  const instance = new ErrorBoundary({ children: "healthy-content" });
  expect(instance.render()).toBe("healthy-content");
});

it("getDerivedStateFromError captures the error into state", () => {
  const err = new Error("boom");
  expect(ErrorBoundary.getDerivedStateFromError(err)).toEqual({ error: err });
});

it("ErrorFallback shows an accessible heading and a Reload button", () => {
  const html = renderToStaticMarkup(<ErrorFallback error={new Error("nope")} onReload={() => {}} />);
  expect(html).toContain("Something went wrong");
  expect(html).toContain("nope");
  expect(html).toContain("<button");
  expect(html).toContain("Reload");
});

it("logUnhandledRejection surfaces the reason via console.error", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const reason = new Error("rejected-ipc");
  logUnhandledRejection(reason);
  expect(spy).toHaveBeenCalled();
  expect(spy.mock.calls[0]).toContain(reason);
  spy.mockRestore();
});
