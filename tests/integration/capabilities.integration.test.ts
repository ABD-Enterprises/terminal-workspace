import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return listSourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

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
  // api/window via dynamic import, and plugin-log), and only these distinct IPC
  // calls exist. #472: persistence no longer uses plugin-sql from the renderer;
  // it calls typed terminal_workspace_persistence_* commands instead. Custom `terminal_workspace_*` commands are NOT
  // ACL-gated by this file — no capability grants them today and the app works.
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
      command: "window.close",
      permission: "core:window:allow-close",
      callSite: "apps/desktop/src/components/layout/AppShell.tsx (Cmd+W with no tabs)",
    },
    {
      command: "log.attachConsole",
      permission: "log:default",
      callSite: "apps/desktop/src/main.tsx",
    },
    {
      command: "log.warn/error",
      permission: "log:default",
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

  it("#472: grants the renderer no SQL plugin permission at all", () => {
    // Any sql: permission hands the renderer a database path or raw SQL
    // (load, select, execute), which reaches files outside the app directory
    // through ATTACH DATABASE or VACUUM INTO.
    const { permissions } = loadDefaultCapability();
    expect(permissions.filter((permission) => permission.startsWith("sql:"))).toEqual([]);
  });

  it("#472: the renderer never imports the SQL plugin", () => {
    const sourceRoot = join(repoRoot, "apps/desktop/src");
    const offenders = listSourceFiles(sourceRoot).filter((file) =>
      readFileSync(file, "utf8").includes("@tauri-apps/plugin-sql")
    );
    expect(offenders).toEqual([]);
  });

  it("still targets the main window", () => {
    const capability = loadDefaultCapability();
    expect(capability.identifier).toBe("default");
    expect(capability.windows).toContain("main");
  });
});
