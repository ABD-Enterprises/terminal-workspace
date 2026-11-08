import { describe, expect, it, vi } from "vitest";
import { importSshConfigText } from "./ssh-config-import";
import type { HostFormValues } from "../types/host";

// #464: the shared import handler every entry point uses (toolbar, welcome
// panel, callout). Entries with no username are imported as they are, but
// named in the report so the user knows why they cannot connect.

async function runImport(config: string) {
  const created: HostFormValues[] = [];
  const report = await importSshConfigText(config, {
    readFile: async () => null,
    createHost: (values) => created.push(values),
  });
  return { created, report };
}

describe("importSshConfigText (#464)", () => {
  it("names entries with no username, keeps them, and leaves the username empty", async () => {
    const { created, report } = await runImport(
      [
        "Host nouser",
        "  HostName nouser.example.com",
        "Host withuser",
        "  HostName withuser.example.com",
        "  User ops",
      ].join("\n")
    );

    expect(report.importedCount).toBe(2);
    expect(report.missingUsernameAliases).toEqual(["nouser"]);
    expect(created.map((host) => [host.label, host.username])).toEqual([
      ["nouser", ""],
      ["withuser", "ops"],
    ]);
  });

  it("does not name an entry that inherits its username from Host *", async () => {
    const { created, report } = await runImport(
      // The parser applies Host * defaults that come before the entry.
      ["Host *", "  User fallback", "Host inherits", "  HostName inherits.example.com"].join("\n")
    );

    expect(report.missingUsernameAliases).toEqual([]);
    expect(created[0]?.username).toBe("fallback");
  });

  it("creates every host and reports skipped lines", async () => {
    const createHost = vi.fn();
    const report = await importSshConfigText("Include missing-file\nHost a\n  User x\n", {
      readFile: async () => null,
      createHost,
    });
    expect(createHost).toHaveBeenCalledTimes(1);
    expect(report.skipped.length).toBeGreaterThan(0);
  });
});
