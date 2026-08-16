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
  // #236: the table is now the COMPLETE census of ACL-controlled Tauri commands
  // this renderer can reach. Verified by scanning apps/desktop/src for every
  // @tauri-apps import: only three modules are reachable (api/event and
  // api/window via dynamic import, plugin-sql), and only these five distinct IPC
  // calls exist. Custom `terminal_workspace_*` commands are NOT ACL-gated by this
  // file — no capability grants them today and the app works.
  const REQUIRED: Array<{ command: string; permission: string; callSite: string }> = [
    {
      command: "event.listen",
      permission: "core:event:allow-listen",
      callSite: "apps/desktop/src/components/layout/AppShell.tsx, lib/backend-runtime.ts",
    },
    {
      command: "event.unlisten (returned callback)",
      permission: "core:event:allow-unlisten",
      callSite: "apps/desktop/src/components/layout/AppShell.tsx, lib/backend-runtime.ts",
    },
    {
      command: "window.setTitle",
      permission: "core:window:allow-set-title",
      callSite: "apps/desktop/src/components/layout/AppShell.tsx",
    },
    {
      command: "Database.load",
      permission: "sql:allow-load",
      callSite: "apps/desktop/src/lib/persistence.ts",
    },
    {
      command: "db.select",
      permission: "sql:allow-select",
      callSite: "apps/desktop/src/lib/persistence.ts",
    },
    {
      command: "db.execute",
      permission: "sql:allow-execute",
      callSite: "apps/desktop/src/lib/persistence.ts",
    },
  ];

  it("grants every ACL-controlled Tauri command the renderer invokes", () => {
    const { permissions } = loadDefaultCapability();

    for (const { command, permission, callSite } of REQUIRED) {
      expect(
        permissions,
        `${command} is called from ${callSite}, so capabilities/default.json must grant ${permission}. ` +
          "Without it Tauri rejects the IPC call at runtime and the packaged app silently misbehaves.",
      ).toContain(permission);
    }
  });

  it("grants NOTHING beyond that census", () => {
    // #236: a `toContain` loop alone would still pass with core:default or
    // sql:default left in place, which is how the app came to grant a large
    // unused menu/tray/path/webview surface. Compare the whole array.
    const { permissions } = loadDefaultCapability();
    const expected = [...new Set(REQUIRED.map((entry) => entry.permission))].sort();

    expect(
      [...permissions].sort(),
      "capabilities/default.json grants a permission with no call site above. Either add the " +
        "call site to the table, or drop the permission — bundled sets like core:default pull in " +
        "a large surface this app never uses.",
    ).toEqual(expected);
  });

  it("still targets the main window", () => {
    const capability = loadDefaultCapability();
    expect(capability.identifier).toBe("default");
    expect(capability.windows).toContain("main");
  });
});
