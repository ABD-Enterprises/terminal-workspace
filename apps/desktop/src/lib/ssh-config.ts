import type { HostFormValues } from "../types/host";
import { emptyHostFormValues } from "../types/host";

/**
 * Single host extracted from an OpenSSH config file. Wildcards have already
 * been resolved into per-host inherited options (so `Host *` defaults flow
 * down into every concrete alias).
 */
export interface ImportedSshConfigHost {
  alias: string;
  hostname: string;
  username: string;
  port: number;
  privateKeyPath: string;
  jumpHostAlias?: string;
}

export interface SshConfigImportSkip {
  reason: "wildcard-only" | "match-block" | "include-directive" | "unparseable" | "missing-hostname";
  detail: string;
}

export interface SshConfigImportResult {
  /** Concrete hosts the user can be offered for import. */
  hosts: ImportedSshConfigHost[];
  /** Anything we silently dropped, with a reason — so callers can show a report. */
  skipped: SshConfigImportSkip[];
  /** Count of hosts that inherited at least one option from `Host *` defaults. */
  defaultsAppliedCount: number;
  /** ProxyJump targets that did not resolve to any concrete host in the file. */
  unresolvedProxyJumpAliases: string[];
}

interface ParsedSshConfigOptions {
  hostname?: string;
  identityFile?: string;
  port?: string;
  proxyJump?: string;
  user?: string;
}

function isWildcardAlias(alias: string) {
  return alias.includes("*") || alias.includes("?") || alias.startsWith("!");
}

function normalizeDirectiveValue(rawValue: string) {
  const inlineCommentIndex = rawValue.search(/\s+#/);
  return (inlineCommentIndex === -1 ? rawValue : rawValue.slice(0, inlineCommentIndex)).trim();
}

function parsePort(value?: string) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 22;
}

function mergeOptions(
  existing: ParsedSshConfigOptions | undefined,
  next: ParsedSshConfigOptions
): ParsedSshConfigOptions {
  return {
    hostname: next.hostname ?? existing?.hostname,
    identityFile: next.identityFile ?? existing?.identityFile,
    port: next.port ?? existing?.port,
    proxyJump: next.proxyJump ?? existing?.proxyJump,
    user: next.user ?? existing?.user,
  };
}

/**
 * Parse an OpenSSH config (the format from `~/.ssh/config`).
 *
 * Capabilities:
 *  - `Host *` (and other wildcard-only Host lines) become defaults that flow
 *    into every concrete alias defined later in the file.
 *  - Multi-host lines (`Host alias1 alias2`) produce one record per alias,
 *    each with the same set of options.
 *  - `ProxyJump <alias>` is preserved on the host record. Only the first
 *    target of a comma-separated chain is captured (one-hop, matching the
 *    desktop app's current jump-host model).
 *  - `IdentityFile`, `User`, `Port`, `HostName` are honored.
 *  - `Match` and `Include` blocks are skipped with a recorded reason so
 *    callers can warn the user that part of their config was not imported.
 *
 * Anything not listed (ProxyCommand, ControlMaster, etc.) is ignored.
 */
export function parseSshConfig(text: string): SshConfigImportResult {
  const lines = text.split(/\r?\n/);
  const globalOptions: ParsedSshConfigOptions = {};
  let currentAliases: string[] = [];
  let currentOptions: ParsedSshConfigOptions = {};
  let currentInheritedDefault = false;
  const aliasMap = new Map<string, ParsedSshConfigOptions>();
  const aliasInheritedDefault = new Set<string>();
  const skipped: SshConfigImportSkip[] = [];

  const flushCurrentBlock = () => {
    if (!currentAliases.length) {
      return;
    }
    currentAliases.forEach((alias) => {
      const existing = aliasMap.get(alias);
      aliasMap.set(alias, mergeOptions(existing, currentOptions));
      if (currentInheritedDefault) {
        aliasInheritedDefault.add(alias);
      }
    });
  };

  lines.forEach((rawLine) => {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const directiveMatch = rawLine.match(/^\s*([A-Za-z][A-Za-z0-9]*)\s+(.*)$/);
    if (!directiveMatch) {
      skipped.push({ reason: "unparseable", detail: trimmed });
      return;
    }

    const [, rawDirective, rawValue] = directiveMatch;
    const directive = rawDirective.toLowerCase();
    const value = normalizeDirectiveValue(rawValue);
    if (!value) {
      return;
    }

    if (directive === "match") {
      flushCurrentBlock();
      currentAliases = [];
      skipped.push({ reason: "match-block", detail: `Match ${value}` });
      return;
    }

    if (directive === "include") {
      skipped.push({ reason: "include-directive", detail: `Include ${value}` });
      return;
    }

    if (directive === "host") {
      flushCurrentBlock();
      const allEntries = value
        .split(/\s+/)
        .map((entry) => entry.trim())
        .filter(Boolean);
      const concreteAliases = allEntries.filter((alias) => !isWildcardAlias(alias));
      const wildcards = allEntries.filter(isWildcardAlias);

      // Record wildcard-only blocks so callers can surface a report.
      if (concreteAliases.length === 0 && wildcards.length > 0) {
        for (const wildcard of wildcards) {
          skipped.push({ reason: "wildcard-only", detail: `Host ${wildcard}` });
        }
      }

      currentAliases = concreteAliases;
      currentInheritedDefault = Object.values(globalOptions).some((entry) => Boolean(entry));
      currentOptions = { ...globalOptions };
      return;
    }

    // Directives outside any concrete Host block flow into globalOptions, so
    // a later `Host alias` block can inherit them.
    const targetOptions = currentAliases.length ? currentOptions : globalOptions;

    switch (directive) {
      case "hostname":
        targetOptions.hostname = value;
        break;
      case "user":
        targetOptions.user = value;
        break;
      case "port":
        targetOptions.port = value;
        break;
      case "identityfile":
        targetOptions.identityFile = value;
        break;
      case "proxyjump":
        targetOptions.proxyJump = value;
        break;
      default:
        break;
    }
  });

  flushCurrentBlock();

  const hosts: ImportedSshConfigHost[] = [];
  const allConcreteAliases = new Set(aliasMap.keys());
  const referencedJumpAliases = new Set<string>();

  for (const [alias, options] of aliasMap.entries()) {
    const hostname = options.hostname?.trim() || alias;
    if (!hostname) {
      skipped.push({ reason: "missing-hostname", detail: `Host ${alias}` });
      continue;
    }
    const jumpHostAlias = options.proxyJump?.split(",")[0]?.trim() || undefined;
    if (jumpHostAlias) {
      referencedJumpAliases.add(jumpHostAlias);
    }
    hosts.push({
      alias,
      hostname,
      username: options.user?.trim() ?? "",
      port: parsePort(options.port),
      privateKeyPath: options.identityFile?.trim() ?? "",
      jumpHostAlias,
    });
  }

  hosts.sort((left, right) => left.alias.localeCompare(right.alias));

  const unresolvedProxyJumpAliases = Array.from(referencedJumpAliases).filter(
    (target) => !allConcreteAliases.has(target)
  );

  return {
    hosts,
    skipped,
    defaultsAppliedCount: aliasInheritedDefault.size,
    unresolvedProxyJumpAliases,
  };
}

/**
 * Adapter for callers that want to feed an imported host into the host editor
 * form. Maps to `HostFormValues` shape (note `port` becomes a string).
 */
export function toHostFormValues(host: ImportedSshConfigHost): Partial<HostFormValues> {
  const usesPrivateKey = Boolean(host.privateKeyPath);
  return {
    label: host.alias,
    hostname: host.hostname,
    username: host.username || emptyHostFormValues.username,
    port: String(host.port),
    privateKeyPath: host.privateKeyPath,
    authMethod: usesPrivateKey ? "privateKey" : emptyHostFormValues.authMethod,
  };
}
