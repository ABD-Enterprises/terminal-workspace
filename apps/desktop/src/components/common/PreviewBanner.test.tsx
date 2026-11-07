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
    const getStatusSpy = vi.spyOn(backendRuntime, "getSessionBackendStatus");

    const { container } = render(<PreviewBanner />);

    expect(container.innerHTML).toBe("");
    expect(getStatusSpy).not.toHaveBeenCalled();
  });

  it("renders the standard preview banner when backend is available in browser mode", async () => {
    vi.spyOn(backendRuntime, "isTauriRuntime").mockReturnValue(false);
    vi.spyOn(backendRuntime, "getSessionBackendStatus").mockResolvedValue({
      ok: true,
    } satisfies BackendStatusResponse);

    render(<PreviewBanner />);

    expect(
      screen.getByText("Preview only - Tauri native ship runs without this backend.")
    ).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders an unreachable alert banner when backend check rejects (#502)", async () => {
    vi.spyOn(backendRuntime, "isTauriRuntime").mockReturnValue(false);
    vi.spyOn(backendRuntime, "getSessionBackendStatus").mockRejectedValue(
      new Error("Failed to fetch")
    );

    render(<PreviewBanner />);

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("Backend server unreachable");
    });
  });
});
