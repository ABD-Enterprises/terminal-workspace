import { isDemoModeEnabled } from "../store/app-store";
import { invokeTauriCommand, isTauriRuntime } from "./backend-runtime";
import { globDemoSshConfigFiles } from "./demo-backend";
import type {
  SshConfigFileReader,
  SshConfigGlobLister,
  SshConfigGlobMatch,
} from "./ssh-config-include";

interface ReadSshConfigFileRequest {
  path: string;
}

interface ReadSshConfigFileResponse {
  content: string;
}

interface GlobSshConfigFilesResponse {
  matches: SshConfigGlobMatch[];
}

/**
 * Native-only: read an SSH config file from `~/.ssh/`. The Rust side
 * canonicalizes the path, rejects anything outside `~/.ssh/`, and returns
 * the file contents. Returns null on rejection or any error so the caller
 * (the Include preprocessor) can log a skip and continue.
 *
 * In dev/web mode (no Tauri runtime), returns null for every path so
 * `Include` directives degrade to the existing "log and skip" behavior.
 */
export const readSshConfigFile: SshConfigFileReader = async (path: string) => {
  if (!isTauriRuntime()) {
    return null;
  }
  try {
    const response = await invokeTauriCommand<ReadSshConfigFileResponse>(
      "termsnip_read_ssh_config_file",
      {
        request: { path } satisfies ReadSshConfigFileRequest,
      }
    );
    return response.content;
  } catch (error) {
    // Any rejection (allowlist, missing, unreadable) becomes a null so the
    // preprocessor logs an `include-directive` skip with the right detail.
    // We log to the console for diagnostics rather than throwing, so a single
    // bad Include in a user's config does not abort the whole import.
    console.warn("[ssh-config] read rejected:", path, error);
    return null;
  }
};

/**
 * #93: expand an Include glob to the files it matches, each with content.
 * Three transports, mirroring the rest of the backend surface:
 * - demo mode → seeded fixture (so the importer demonstrates multi-file
 *   expansion without a real ~/.ssh tree);
 * - native (Tauri) → `termsnip_glob_ssh_config_files`, which refuses any
 *   match outside `~/.ssh/`;
 * - browser/HTTP → `/api/backend/ssh-config/glob`, same refusal server-side.
 *
 * Any failure resolves to `[]` so a single bad glob logs a skip rather than
 * aborting the whole import.
 */
export const globSshConfigFiles: SshConfigGlobLister = async (pattern: string) => {
  if (isDemoModeEnabled()) {
    return globDemoSshConfigFiles(pattern);
  }
  if (isTauriRuntime()) {
    try {
      const response = await invokeTauriCommand<GlobSshConfigFilesResponse>(
        "termsnip_glob_ssh_config_files",
        { request: { pattern } }
      );
      return response.matches;
    } catch (error) {
      console.warn("[ssh-config] glob rejected:", pattern, error);
      return [];
    }
  }
  try {
    const response = await fetch("/api/backend/ssh-config/glob", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pattern }),
    });
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as GlobSshConfigFilesResponse;
    return data.matches ?? [];
  } catch (error) {
    console.warn("[ssh-config] glob rejected:", pattern, error);
    return [];
  }
};
