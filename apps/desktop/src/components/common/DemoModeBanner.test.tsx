// @vitest-environment happy-dom
//
// Demo-mode indicator.
//
// Demo mode swaps every connection for a mock transport, so the command
// output, the SFTP listing and the host-key scan the user sees are all
// fabricated. Before this banner, the only warning was one line buried in
// terminal scrollback, so a user who clicked "Load sample data" could run an
// entire "successful" workflow against fake output without knowing it.
//
// This pins the indicator contract: it is visible exactly when demo mode is
// on, it is announced to assistive tech, and it says the output is fake.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DemoModeBanner } from "./DemoModeBanner";
import { useAppStore } from "../../store/app-store";

function setDemoMode(enabled: boolean) {
  useAppStore.setState({ ...useAppStore.getState(), demoModeEnabled: enabled });
}

describe("DemoModeBanner", () => {
  beforeEach(() => {
    setDemoMode(false);
  });

  afterEach(() => {
    cleanup();
    setDemoMode(false);
  });

  it("renders nothing when demo mode is off", () => {
    const { container } = render(<DemoModeBanner />);

    expect(container.innerHTML).toBe("");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("warns that the output is fabricated when demo mode is on", () => {
    setDemoMode(true);

    render(<DemoModeBanner />);

    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("Demo mode");
    expect(banner.textContent).toContain("fabricated");
  });

  it("announces itself to assistive tech", () => {
    setDemoMode(true);

    render(<DemoModeBanner />);

    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Demo mode");
  });
});
