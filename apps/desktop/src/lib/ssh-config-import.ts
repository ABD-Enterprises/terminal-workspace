import { parseSshConfig, toHostFormValues } from "./ssh-config";
import {
  resolveSshIncludes,
  type SshConfigFileReader,
  type SshConfigGlobLister,
} from "./ssh-config-include";
import { emptyHostFormValues, type HostFormValues } from "../types/host";

export interface SshConfigImportReport {
  importedCount: number;
  defaultsAppliedCount: number;
  unresolvedProxyJumpAliases: string[];
  /**
   * #464: imported entries that ended up with no username, inherited ones
   * included. They are still imported, and nothing guesses a user, but they
   * cannot connect until one is added, so the report names them.
   */
  missingUsernameAliases: string[];
  skipped: { reason: string; detail: string }[];
}

interface ImportSshConfigOptions {
  readFile: SshConfigFileReader;
  globFiles?: SshConfigGlobLister;
  createHost: (values: HostFormValues) => void;
}

/**
 * Import an SSH config's text: resolve Includes, parse, create a host for
 * every entry, and report what happened. Shared by every import entry point
 * (the toolbar, the cold-start welcome panel and the import callout).
 */
export async function importSshConfigText(
  content: string,
  { readFile, globFiles, createHost }: ImportSshConfigOptions
): Promise<SshConfigImportReport> {
  const expanded = await resolveSshIncludes(content, { readFile, globFiles });
  const result = parseSshConfig(expanded.text);
  const missingUsernameAliases: string[] = [];
  for (const host of result.hosts) {
    const values = { ...emptyHostFormValues, ...toHostFormValues(host) };
    if (values.username.trim() === "") {
      missingUsernameAliases.push(host.alias);
    }
    createHost(values);
  }
  return {
    importedCount: result.hosts.length,
    defaultsAppliedCount: result.defaultsAppliedCount,
    unresolvedProxyJumpAliases: result.unresolvedProxyJumpAliases,
    missingUsernameAliases,
    skipped: [...result.skipped, ...expanded.skipped],
  };
}
