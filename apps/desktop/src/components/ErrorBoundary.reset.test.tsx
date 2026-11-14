// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary, ScopedErrorFallback } from "./ErrorBoundary";

function Boom(): never {
  throw new Error("route exploded");
}

function renderBoundary(resetKey: string, crash: boolean) {
  return (
    <ErrorBoundary
      resetKey={resetKey}
      fallback={(error, retry) => <ScopedErrorFallback error={error} onRetry={retry} />}
    >
      {crash ? <Boom /> : <p>healthy page</p>}
    </ErrorBoundary>
  );
}

describe("ErrorBoundary resetKey", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the next page after navigating away from a crashed one", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = render(renderBoundary("/hosts", true));
    expect(screen.getByText("This view hit an error")).toBeDefined();

    view.rerender(renderBoundary("/settings", false));

    expect(screen.queryByText("This view hit an error")).toBeNull();
    expect(screen.getByText("healthy page")).toBeDefined();
  });

  it("keeps the fallback while the key is unchanged", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = render(renderBoundary("/hosts", true));

    view.rerender(renderBoundary("/hosts", false));

    expect(screen.getByText("This view hit an error")).toBeDefined();
  });
});
