import type { SshConfigImportSkip } from "./ssh-config";

/**
 * Result of expanding `Include` directives in an OpenSSH config text. The
 * caller passes the resulting `text` to `parseSshConfig`. `skipped` carries
 * any Include lines that were rejected (cycle, not-found, allowlist), so the
 * import-summary modal can still tell the user what was dropped.
 */
export interface ResolveSshIncludesResult {
  text: string;
  skipped: SshConfigImportSkip[];
}

/**
 * Read an SSH config file's contents by user-supplied path. Returning `null`
 * means the path was rejected (allowlist, missing, unreadable) — the caller
 * logs an `include-directive` skip with an appropriate reason. Implementations
 * are expected to:
 *
 * - resolve `~` to the user's home directory
 * - canonicalize the path (resolve symlinks)
 * - reject any canonical path that is not under `~/.ssh/`
 *
 * The renderer's native binding wraps the `terminal_workspace_read_ssh_config_file`
 * Tauri command. In dev/web mode the importer passes a no-op reader that
 * returns `null` for every path, so Include lines fall back to the existing
 * "log and skip" behavior.
 */
export interface SshConfigFileRead {
  /** Opaque identity derived from the canonical file under a process-random salt. */
  cycleKey: string;
  content: string;
}

/**
 * Context for resolving a nested relative Include beside its canonical
 * containing file without returning that canonical path to the renderer.
 */
export interface SshConfigResolutionContext {
  /** Backend-issued identity used to recover the containing file's canonical location. */
  parentCycleKey: string;
  relativePath: string;
}

export type SshConfigFileReader = (
  resolvedPath: string,
  context?: SshConfigResolutionContext
) => Promise<SshConfigFileRead | null>;

/** A single file matched by a glob Include, with its already-read content. */
export interface SshConfigGlobMatch {
  /** Opaque identity derived from the canonical file under a process-random salt. */
  cycleKey: string;
  /** Final directory-entry name matched by the caller's glob; never a resolved path. */
  name: string;
  content: string;
}

/**
 * Expand an OpenSSH glob Include pattern (e.g. `~/.ssh/conf.d/*`) into the
 * concrete files it matches, returning each file's content. Implementations
 * MUST refuse any pattern or match that resolves outside `~/.ssh/`. The
 * caller orders matches itself (byte order, as OpenSSH does). A lister that
 * caps its results should pick the first files in that order and set
 * `truncated` (#486). Returning `[]` means "no matches / not available" — the
 * caller logs a skip.
 *
 * #93: the native binding wraps `terminal_workspace_glob_ssh_config_files`; the HTTP
 * backend exposes `/api/backend/ssh-config/glob`; demo mode returns a seeded
 * fixture. When no lister is supplied, glob Includes fall back to the previous
 * "log and skip" behavior.
 */
export interface SshConfigGlobResult {
  matches: SshConfigGlobMatch[];
  /** More files matched than the lister returns. */
  truncated?: boolean;
}

export type SshConfigGlobLister = (
  pattern: string,
  context?: SshConfigResolutionContext
) => Promise<SshConfigGlobMatch[] | SshConfigGlobResult>;

/**
 * #486: OpenSSH applies Include glob matches in byte order (glob(3) sorts
 * with the C locale), so uppercase sorts before lowercase and `_` after both
 * digits and uppercase. UTF-8 byte order is Unicode code point order, which
 * plain `<` on JS strings does not give for characters outside the BMP.
 */
export function compareOpenSshNames(left: string, right: string): number {
  const a = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const b = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }
  return a.length - b.length;
}

export interface ResolveSshIncludesOptions {
  readFile: SshConfigFileReader;
  /** Optional glob expander; when omitted, glob Includes are skipped. */
  globFiles?: SshConfigGlobLister;
  /**
   * Directory used to resolve relative Include paths. OpenSSH resolves
   * relative includes against the directory of the file containing them.
   * The renderer uses `~/.ssh` as the default because the import flow only
   * knows the user picked a single file via FileReader, not its absolute
   * path; that's the canonical location for `config` and the only one the
   * Tauri allowlist permits.
   */
  baseDir?: string;
  /**
   * Maximum depth of nested Includes. Ten is generous — real configs nest
   * two or three levels at most, and the visited-identities set blocks true
   * cycles. The depth cap is a defensive limit on pathological chains
   * (tens of thousands of files referenced from a top-level glob, etc).
   */
  maxDepth?: number;
}

/** Options after defaults are applied; `globFiles` stays optional. */
interface ResolvedSshIncludesOptions {
  readFile: SshConfigFileReader;
  globFiles?: SshConfigGlobLister;
  baseDir: string;
  maxDepth: number;
}

const DEFAULT_BASE_DIR = "~/.ssh";
const DEFAULT_MAX_DEPTH = 10;
const INCLUDE_DIRECTIVE_RE = /^\s*include\s+(.*?)\s*(?:#.*)?$/i;
const BLOCK_DIRECTIVE_RE = /^\s*(host|match)\s+/i;

function normalizePath(rawPath: string, baseDir: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("/") || trimmed.startsWith("~")) return trimmed;
  // Strip trailing slash from baseDir to keep "x" + "/" + "y" predictable.
  const base = baseDir.endsWith("/") ? baseDir.slice(0, -1) : baseDir;
  return `${base}/${trimmed}`;
}

function dirnamePath(path: string): string {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const slashIndex = trimmed.lastIndexOf("/");
  if (slashIndex <= 0) {
    return slashIndex === 0 ? "/" : ".";
  }
  return trimmed.slice(0, slashIndex);
}

function hasGlobChar(value: string): boolean {
  return value.includes("*") || value.includes("?") || value.includes("[");
}

function isRelativePath(value: string): boolean {
  return !value.startsWith("/") && !value.startsWith("~");
}

function resolutionContext(
  entry: string,
  currentFile: { cycleKey: string } | undefined
): SshConfigResolutionContext | undefined {
  if (!currentFile || !isRelativePath(entry)) return undefined;
  return {
    parentCycleKey: currentFile.cycleKey,
    relativePath: entry,
  };
}

async function expandText(
  text: string,
  options: ResolvedSshIncludesOptions,
  currentBaseDir: string,
  currentFile: { cycleKey: string } | undefined,
  visited: Set<string>,
  depth: number,
  skipped: SshConfigImportSkip[]
): Promise<string> {
  if (depth > options.maxDepth) {
    skipped.push({
      reason: "include-directive",
      detail: `Include depth limit (${options.maxDepth}) exceeded`,
    });
    return "";
  }

  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let insideConditionalBlock = false;

  for (const line of lines) {
    if (BLOCK_DIRECTIVE_RE.test(line)) {
      insideConditionalBlock = true;
      out.push(line);
      continue;
    }

    const match = line.match(INCLUDE_DIRECTIVE_RE);
    if (!match) {
      out.push(line);
      continue;
    }
    const rawValue = match[1];
    if (!rawValue) {
      out.push(line);
      continue;
    }

    if (insideConditionalBlock) {
      skipped.push({
        reason: "include-directive",
        detail: `Include ${rawValue} (conditional block unsupported)`,
      });
      continue;
    }

    // Multiple paths per Include line are supported by OpenSSH; expand each.
    const entries = rawValue.split(/\s+/).filter(Boolean);
    for (const entry of entries) {
      if (hasGlobChar(entry)) {
        // #93: globs are valid OpenSSH. When a glob lister is available we
        // ask the backend (native / HTTP / demo) to expand the pattern —
        // refusing anything outside ~/.ssh — and inline each match in byte
        // order, as OpenSSH does (#486). Without a lister we keep the old
        // "log and skip" behavior.
        if (!options.globFiles) {
          skipped.push({
            reason: "include-directive",
            detail: `Include ${entry} (glob unsupported)`,
          });
          continue;
        }
        const pattern = normalizePath(entry, currentBaseDir);
        let matches: SshConfigGlobMatch[];
        let truncated: boolean;
        try {
          const listed = await options.globFiles(pattern, resolutionContext(entry, currentFile));
          matches = Array.isArray(listed) ? listed : listed.matches;
          truncated = !Array.isArray(listed) && listed.truncated === true;
        } catch (error) {
          skipped.push({
            reason: "include-directive",
            detail: `Include ${entry} (glob error: ${(error as Error).message})`,
          });
          continue;
        }
        if (matches.length === 0) {
          skipped.push({
            reason: "include-directive",
            detail: `Include ${entry} (no matching files)`,
          });
          continue;
        }
        if (truncated) {
          skipped.push({
            reason: "include-directive",
            detail: `Include ${entry} matched more files than can be read; only the first ${matches.length} in OpenSSH order were applied`,
          });
        }
        const ordered = [...matches].sort((left, right) =>
          compareOpenSshNames(left.name, right.name)
        );
        for (const matchEntry of ordered) {
          if (visited.has(matchEntry.cycleKey)) {
            skipped.push({
              reason: "include-directive",
              detail: `Include ${entry} matched file ${JSON.stringify(matchEntry.name)} (cycle)`,
            });
            continue;
          }
          const nextVisited = new Set(visited);
          nextVisited.add(matchEntry.cycleKey);
          const matchPath = normalizePath(matchEntry.name, dirnamePath(pattern));
          const expanded = await expandText(
            matchEntry.content,
            options,
            dirnamePath(matchPath),
            { cycleKey: matchEntry.cycleKey },
            nextVisited,
            depth + 1,
            skipped
          );
          out.push(expanded);
        }
        continue;
      }
      const normalized = normalizePath(entry, currentBaseDir);
      let included: SshConfigFileRead | null;
      try {
        included = await options.readFile(normalized, resolutionContext(entry, currentFile));
      } catch (error) {
        skipped.push({
          reason: "include-directive",
          detail: `Include ${entry} (read error: ${(error as Error).message})`,
        });
        continue;
      }
      if (included === null) {
        skipped.push({
          reason: "include-directive",
          detail: `Include ${entry} (not found or rejected)`,
        });
        continue;
      }
      if (visited.has(included.cycleKey)) {
        skipped.push({
          reason: "include-directive",
          detail: `Include ${entry} (cycle)`,
        });
        continue;
      }
      const nextVisited = new Set(visited);
      nextVisited.add(included.cycleKey);
      const expanded = await expandText(
        included.content,
        options,
        dirnamePath(normalized),
        { cycleKey: included.cycleKey },
        nextVisited,
        depth + 1,
        skipped
      );
      out.push(expanded);
    }
  }

  return out.join("\n");
}

/**
 * Inline OpenSSH `Include` directives in `initialText` by reading each
 * referenced file via `options.readFile` and replacing the directive line
 * with the included file's content. Recursively expands nested Includes.
 *
 * Rejections (cycles, allowlist failures, glob-unsupported, missing files)
 * are returned in `skipped` so the parser's existing import-summary modal
 * can surface them.
 *
 * Pure async. Does not mutate `initialText`. Designed to run before
 * `parseSshConfig` so the parser stays sync and Include-agnostic.
 */
export async function resolveSshIncludes(
  initialText: string,
  options: ResolveSshIncludesOptions
): Promise<ResolveSshIncludesResult> {
  const skipped: SshConfigImportSkip[] = [];
  const filled: ResolvedSshIncludesOptions = {
    readFile: options.readFile,
    globFiles: options.globFiles,
    baseDir: options.baseDir ?? DEFAULT_BASE_DIR,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
  };
  const text = await expandText(
    initialText,
    filled,
    filled.baseDir,
    undefined,
    new Set(),
    0,
    skipped
  );
  return { text, skipped };
}
