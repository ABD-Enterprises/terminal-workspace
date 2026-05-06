import { invokeTauriCommand, isTauriRuntime } from "./backend-runtime";
import type { SshConfigFileReader } from "./ssh-config-include";

interface ReadSshConfigFileRequest {
  path: string;
}

interface ReadSshConfigFileResponse {
  content: string;
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
