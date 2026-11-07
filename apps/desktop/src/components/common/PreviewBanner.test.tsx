// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewBanner } from "./PreviewBanner";
import type { BackendStatusResponse } from "../../lib/backend-contract";
import * as backendRuntime from "../../lib/backend-runtime";

describe("PreviewBanner (#502)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders nothing in native Tauri runtime", () => {
    vi.spyOn(backendRuntime, "isTauriRuntime").mockReturnValue(true);
    const probeSpy = vi.spyOn(backendRuntime, "probeBackendStatus");

    const { container } = render(<PreviewBanner />);

    expect(container.innerHTML).toBe("");
    expect(probeSpy).not.toHaveBeenCalled();
  });

  it("renders the standard preview banner when backend is available in browser mode", async () => {
    vi.spyOn(backendRuntime, "isTauriRuntime").mockReturnValue(false);
    const probe = vi
      .spyOn(backendRuntime, "probeBackendStatus")
      .mockResolvedValue({ ok: true } satisfies BackendStatusResponse);

    render(<PreviewBanner />);

    await waitFor(() => expect(probe).toHaveBeenCalled());
    expect(
      screen.getByText("Preview only - Tauri native ship runs without this backend.")
    ).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders an unreachable alert banner on a network failure (#502)", async () => {
    vi.spyOn(backendRuntime, "isTauriRuntime").mockReturnValue(false);
    vi.spyOn(backendRuntime, "probeBackendStatus").mockRejectedValue(
      new backendRuntime.BackendProbeError("unreachable", "Failed to fetch")
    );

    render(<PreviewBanner />);

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Backend server unreachable");
    });
  });

  it("does not call an auth refusal unreachable", async () => {
    vi.spyOn(backendRuntime, "isTauriRuntime").mockReturnValue(false);
    vi.spyOn(backendRuntime, "probeBackendStatus").mockRejectedValue(
      new backendRuntime.BackendProbeError("unauthorized", "refused", 403)
    );

    render(<PreviewBanner />);

    await waitFor(() => {
      const text = screen.getByRole("alert").textContent ?? "";
      expect(text).toContain("refused this page");
      expect(text).not.toContain("unreachable");
    });
  });
});
