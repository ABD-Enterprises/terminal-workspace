// @vitest-environment happy-dom
//
// Connect-failure surfacing.
//
// Every connect entry point — the hosts page, quick-connect, the sidebar's
// local/pinned/recent lists, the command palette, and the first-run welcome
// panel — funnels through launchHostSession. Those failures used to be
// computed correctly and then dropped into a console.warn at each call site,
// so a host that was down, firewalled, or mis-typed produced no on-screen
// output at all: the user clicked "Open", no tab appeared, and the app looked
// broken.
//
// This pins the banner contract: the message reaches the screen, it is
// announced to assistive tech, and the user can dismiss it.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectErrorBanner } from "./ConnectErrorBanner";
import { useConnectErrorStore } from "../../store/connect-error-store";

describe("ConnectErrorBanner", () => {
  beforeEach(() => {
    useConnectErrorStore.getState().clearConnectError();
  });

  afterEach(() => {
    cleanup();
    useConnectErrorStore.getState().clearConnectError();
  });

  it("renders nothing when there is no failure to report", () => {
    render(<ConnectErrorBanner />);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the reported message", () => {
    useConnectErrorStore
      .getState()
      .setConnectError("Could not scan example.internal:22. Check that the host is reachable and try again.");

    render(<ConnectErrorBanner />);

    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("Could not scan example.internal:22.");
  });

  it("announces the failure to assistive tech", () => {
    useConnectErrorStore.getState().setConnectError("Something failed.");

    render(<ConnectErrorBanner />);

    expect(screen.getByRole("alert").getAttribute("aria-label")).toBe("Connection failed");
  });

  it("reports a user-initiated cancellation as a warning rather than an error", () => {
    useConnectErrorStore.getState().setConnectError("Connection cancelled.", "warning");

    render(<ConnectErrorBanner />);

    expect(screen.getByRole("alert").getAttribute("aria-label")).toBe("Connection cancelled");
  });

  it("dismisses the message", () => {
    useConnectErrorStore.getState().setConnectError("Something failed.");

    render(<ConnectErrorBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(useConnectErrorStore.getState().message).toBeNull();
  });
});
