import { describe, expect, it } from "vitest";

import {
  INITIAL_UPDATE_INSTALL_PROGRESS,
  deriveDownloadPercentage,
  deriveUpdateInstallMessage,
  reduceUpdateInstallProgress,
} from "./UpdateAvailableBanner";

it("imports successfully", async () => {
  const mod = await import("./UpdateAvailableBanner");
  expect(mod.UpdateAvailableBanner).toBeDefined();
});

describe("update install progress", () => {
  it("keeps an unknown download total indeterminate", () => {
    const state = reduceUpdateInstallProgress(INITIAL_UPDATE_INSTALL_PROGRESS, {
      type: "progress",
      progress: { phase: "downloading", downloaded: 64, total: null },
    });

    expect(deriveDownloadPercentage(state)).toBeNull();
    expect(deriveUpdateInstallMessage(state, "0.2.0")).toBe("Downloading update…");
  });

  it("advances known download progress", () => {
    const first = reduceUpdateInstallProgress(INITIAL_UPDATE_INSTALL_PROGRESS, {
      type: "progress",
      progress: { phase: "downloading", downloaded: 25, total: 100 },
    });
    const second = reduceUpdateInstallProgress(first, {
      type: "progress",
      progress: { phase: "downloading", downloaded: 60, total: 100 },
    });

    expect(deriveDownloadPercentage(first)).toBe(25);
    expect(deriveDownloadPercentage(second)).toBe(60);
  });

  it("transitions from downloading to installing without a percentage", () => {
    const downloading = reduceUpdateInstallProgress(INITIAL_UPDATE_INSTALL_PROGRESS, {
      type: "progress",
      progress: { phase: "downloading", downloaded: 75, total: 100 },
    });
    const installing = reduceUpdateInstallProgress(downloading, {
      type: "progress",
      progress: { phase: "installing" },
    });

    expect(installing).toEqual({ phase: "installing" });
    expect(deriveDownloadPercentage(installing)).toBeNull();
    expect(deriveUpdateInstallMessage(installing, "0.2.0")).toBe("Installing update…");
  });

  it("does not let late download progress demote installing or failed states", () => {
    const lateProgress = {
      type: "progress" as const,
      progress: { phase: "downloading" as const, downloaded: 90, total: 100 },
    };
    const installing = { phase: "installing" as const };
    const failed = { phase: "failed" as const, reason: "signature mismatch" };

    expect(reduceUpdateInstallProgress(installing, lateProgress)).toBe(installing);
    expect(reduceUpdateInstallProgress(failed, lateProgress)).toBe(failed);
  });

  it("never decreases downloaded bytes", () => {
    const current = { phase: "downloading" as const, downloaded: 60, total: 100 };
    const regressed = reduceUpdateInstallProgress(current, {
      type: "progress",
      progress: { phase: "downloading", downloaded: 25, total: 100 },
    });

    expect(regressed).toEqual(current);
  });

  it("surfaces the install failure reason", () => {
    const failed = reduceUpdateInstallProgress(INITIAL_UPDATE_INSTALL_PROGRESS, {
      type: "failed",
      reason: "connection reset during download",
    });

    expect(deriveUpdateInstallMessage(failed, "0.2.0")).toBe(
      "Update 0.2.0 could not be installed: connection reset during download",
    );
  });
});
