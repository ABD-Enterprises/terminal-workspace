import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// #235: the window title silently stopped updating in packaged builds because
// AppShell invokes window.setTitle() while capabilities/default.json granted only
// core:window's bundled default — which includes `allow-title` (the getter), not
// `allow-set-title`. The IPC call was rejected and the rejection was swallowed, so
// nothing failed loudly at any layer.
//
// This test pins the grant to the invocation. It matters most for #236, which
// narrows these permissions away from bundled sets: removing a permission the app
// actually calls reproduces exactly the defect above, and only an assertion like
// this turns that into a red test instead of a silent regression.

const capabilitiesPath = fileURLToPath(
  new URL("../../src-tauri/capabilities/default.json", import.meta.url),
);

type Capability = {
  identifier: string;
  windows: string[];
  permissions: string[];
};

function loadDefaultCapability(): Capability {
  return JSON.parse(readFileSync(capabilitiesPath, "utf8")) as Capability;
}

describe("src-tauri/capabilities/default.json", () => {
  it("grants every Tauri command the renderer invokes", () => {
    const { permissions } = loadDefaultCapability();

    // Each entry is a command the frontend actually calls, paired with the leaf
    // permission that authorises it. Add a row when you add an invoke() site.
    const required: Array<{ command: string; permission: string; callSite: string }> = [
      {
        command: "window.setTitle",
        permission: "core:window:allow-set-title",
        callSite: "apps/desktop/src/components/layout/AppShell.tsx",
      },
    ];

    for (const { command, permission, callSite } of required) {
      expect(
        permissions,
        `${command} is called from ${callSite}, so capabilities/default.json must grant ${permission}. ` +
          "Without it Tauri rejects the IPC call at runtime and the packaged app silently misbehaves.",
      ).toContain(permission);
    }
  });

  it("still targets the main window", () => {
    const capability = loadDefaultCapability();
    expect(capability.identifier).toBe("default");
    expect(capability.windows).toContain("main");
  });
});
