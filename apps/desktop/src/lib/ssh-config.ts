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

type ParsedSshConfigOptionKey = keyof ParsedSshConfigOptions;

type OrderedSshConfigOptions = {
  [key in ParsedSshConfigOptionKey]?: {
    order: number;
    value: string;
  };
};

function isWildcardAlias(alias: string) {
  return alias.includes("*") || alias.includes("?") || alias.startsWith("!");
}

function normalizeDirectiveValue(rawValue: string) {
  const inlineCommentIndex = rawValue.search(/\s+#/);
  return (inlineCommentIndex === -1 ? rawValue : rawValue.slice(0, inlineCommentIndex)).trim();
}

type MatchCriterion =
  | { type: "host" | "originalhost" | "user"; patterns: string[] }
  | { type: "all" };

interface MatchBlockState {
  criteria: MatchCriterion[];
  options: OrderedSshConfigOptions;
}

const SUPPORTED_MATCH_KEYWORDS = new Set(["host", "originalhost", "user", "all"]);

const REJECTED_MATCH_KEYWORDS = new Set([
  "exec",
  "localuser",
  "canonical",
  "final",
  "localnetwork",
  "tagged",
]);

function cloneOptions(options: OrderedSshConfigOptions): OrderedSshConfigOptions {
  return Object.fromEntries(Object.entries(options)) as OrderedSshConfigOptions;
}

function setOptionIfUnset(
  options: OrderedSshConfigOptions,
  key: ParsedSshConfigOptionKey,
  value: string,
  order: number
) {
  if (!options[key]) {
    options[key] = { value, order };
  }
}

function optionValue(options: OrderedSshConfigOptions, key: ParsedSshConfigOptionKey) {
  return options[key]?.value;
}

function hasAnyOptions(options: OrderedSshConfigOptions) {
  return Object.values(options).some((entry) => entry !== undefined);
}

/**
 * Match an OpenSSH glob pattern (with `*` and `?` wildcards) against a value
 * using a position-based iterative matcher. Deliberately avoids `new RegExp`
 * here so there is no dynamic-regex / ReDoS surface — the matcher runs in
 * O(n*m) worst case without backtracking explosion.
 */
function matchesGlob(pattern: string, value: string): boolean {
  let pi = 0;
  let vi = 0;
  let starP = -1;
  let starV = 0;
  while (vi < value.length) {
    if (pi < pattern.length && (pattern[pi] === "?" || pattern[pi] === value[vi])) {
      pi += 1;
      vi += 1;
    } else if (pi < pattern.length && pattern[pi] === "*") {
      starP = pi;
      starV = vi;
      pi += 1;
    } else if (starP !== -1) {
      pi = starP + 1;
      starV += 1;
      vi = starV;
    } else {
      return false;
    }
  }
  while (pi < pattern.length && pattern[pi] === "*") pi += 1;
  return pi === pattern.length;
}

/**
 * Match an OpenSSH pattern list against a value: positive patterns are OR'd, a
 * negated pattern (`!foo`) excludes the value if it matches. If the list has
 * only negations, an unmatched value is considered a hit (the OpenSSH default
 * for "host !foo,!bar" — anything but those).
 */
function patternListMatches(patterns: string[], value: string): boolean {
  let hasPositive = false;
  let positiveHit = false;
  for (const pattern of patterns) {
    if (!pattern) continue;
    if (pattern.startsWith("!")) {
      if (matchesGlob(pattern.slice(1), value)) return false;
    } else {
      hasPositive = true;
      if (matchesGlob(pattern, value)) positiveHit = true;
    }
  }
  return hasPositive ? positiveHit : true;
}

interface ParsedMatchHeader {
  criteria: MatchCriterion[];
  rejected?: string;
}

function parseMatchCriteria(value: string): ParsedMatchHeader {
  const tokens = value.split(/\s+/).filter(Boolean);
  const criteria: MatchCriterion[] = [];
  let i = 0;
  while (i < tokens.length) {
    const keyword = tokens[i].toLowerCase();
    if (REJECTED_MATCH_KEYWORDS.has(keyword)) {
      return { criteria: [], rejected: keyword };
    }
    if (keyword === "all") {
      criteria.push({ type: "all" });
      i += 1;
      continue;
    }
    if (!SUPPORTED_MATCH_KEYWORDS.has(keyword)) {
      return { criteria: [], rejected: `unknown:${keyword}` };
    }
    const rawPatterns = tokens[i + 1];
    if (!rawPatterns) {
      return { criteria: [], rejected: `${keyword}:missing-pattern` };
    }
    const patterns = rawPatterns.split(",").map((p) => p.trim()).filter(Boolean);
    if (patterns.length === 0) {
      return { criteria: [], rejected: `${keyword}:empty-pattern` };
    }
    criteria.push({
      type: keyword as "host" | "originalhost" | "user",
      patterns,
    });
    i += 2;
  }
  if (criteria.length === 0) {
    return { criteria: [], rejected: "empty" };
  }
  if (criteria.some((criterion) => criterion.type === "all") && criteria.length > 1) {
    return { criteria: [], rejected: "all:combined" };
  }
  return { criteria };
}

function applyMatchBlocks(
  blocks: MatchBlockState[],
  aliasMap: Map<string, OrderedSshConfigOptions>
) {
  for (const block of blocks) {
    if (!hasAnyOptions(block.options)) {
      // Match block carried no options the importer tracks; nothing to apply.
      // Still useful to validate parsing without surprising callers.
      continue;
    }
    for (const [alias, options] of aliasMap.entries()) {
      const aliasUser = optionValue(options, "user") ?? "";
      const matches = block.criteria.every((criterion) => {
        if (criterion.type === "all") return true;
        if (criterion.type === "user") return patternListMatches(criterion.patterns, aliasUser);
        return patternListMatches(criterion.patterns, alias);
      });
      if (matches) {
        aliasMap.set(alias, mergeOptions(options, block.options));
      }
    }
  }
}

function parsePort(value?: string) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 22;
}

function mergeOptions(
  existing: OrderedSshConfigOptions | undefined,
  next: OrderedSshConfigOptions
): OrderedSshConfigOptions {
  const merged: OrderedSshConfigOptions = { ...existing };
  const keys: ParsedSshConfigOptionKey[] = ["hostname", "identityFile", "port", "proxyJump", "user"];
  for (const key of keys) {
    const candidate = next[key];
    if (!candidate) continue;
    const current = merged[key];
    if (!current || candidate.order < current.order) {
      merged[key] = candidate;
    }
  }
  return merged;
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
 *  - `Match host`, `Match originalhost`, `Match user`, and `Match all` apply
 *    their options to every concrete alias whose alias (host/originalhost) or
 *    User (user) matches the comma-separated pattern list. Negated patterns
 *    (`!foo`) exclude. `Match exec` and unsupported criteria (canonical, final,
 *    localnetwork, localuser, tagged) are skipped with a recorded reason.
 *  - `Include` blocks are skipped with a recorded reason so callers can warn
 *    the user that part of their config was not imported (Include support
 *    requires a backend filesystem primitive — see issue #28).
 *
 * Anything not listed (ProxyCommand, ControlMaster, etc.) is ignored.
 */
export function parseSshConfig(text: string): SshConfigImportResult {
  const lines = text.split(/\r?\n/);
  const globalOptions: OrderedSshConfigOptions = {};
  let currentAliases: string[] = [];
  let currentOptions: OrderedSshConfigOptions = {};
  let currentInheritedDefault = false;
  let currentMatch: MatchBlockState | null = null;
  let currentSkip = false;
  let optionOrder = 0;
  const matchBlocks: MatchBlockState[] = [];
  const aliasMap = new Map<string, OrderedSshConfigOptions>();
  const aliasInheritedDefault = new Set<string>();
  const skipped: SshConfigImportSkip[] = [];

  const flushCurrentBlock = () => {
    if (currentAliases.length) {
      currentAliases.forEach((alias) => {
        const existing = aliasMap.get(alias);
        aliasMap.set(alias, mergeOptions(existing, currentOptions));
        if (currentInheritedDefault) {
          aliasInheritedDefault.add(alias);
        }
      });
      return;
    }
    if (currentMatch) {
      matchBlocks.push(currentMatch);
    }
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
      currentMatch = null;
      currentSkip = false;
      const parsed = parseMatchCriteria(value);
      if (parsed.rejected) {
        skipped.push({
          reason: "match-block",
          detail: `Match ${value} (skipped: ${parsed.rejected})`,
        });
        currentSkip = true;
        return;
      }
      currentMatch = { criteria: parsed.criteria, options: {} };
      return;
    }

    if (directive === "include") {
      skipped.push({ reason: "include-directive", detail: `Include ${value}` });
      return;
    }

    if (directive === "host") {
      flushCurrentBlock();
      currentMatch = null;
      currentSkip = false;
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
      currentInheritedDefault = hasAnyOptions(globalOptions);
      currentOptions = cloneOptions(globalOptions);
      return;
    }

    if (currentSkip) {
      return;
    }

    // Directives outside any concrete Host or Match block flow into
    // globalOptions, so a later `Host alias` block can inherit them.
    const targetOptions = currentAliases.length
      ? currentOptions
      : currentMatch
      ? currentMatch.options
      : globalOptions;
    optionOrder += 1;

    switch (directive) {
      case "hostname":
        setOptionIfUnset(targetOptions, "hostname", value, optionOrder);
        break;
      case "user":
        setOptionIfUnset(targetOptions, "user", value, optionOrder);
        break;
      case "port":
        setOptionIfUnset(targetOptions, "port", value, optionOrder);
        break;
      case "identityfile":
        setOptionIfUnset(targetOptions, "identityFile", value, optionOrder);
        break;
      case "proxyjump":
        setOptionIfUnset(targetOptions, "proxyJump", value, optionOrder);
        break;
      default:
        break;
    }
  });

  flushCurrentBlock();
  applyMatchBlocks(matchBlocks, aliasMap);

  const hosts: ImportedSshConfigHost[] = [];
  const allConcreteAliases = new Set(aliasMap.keys());
  const referencedJumpAliases = new Set<string>();

  for (const [alias, options] of aliasMap.entries()) {
    const hostname = optionValue(options, "hostname")?.trim() || alias;
    if (!hostname) {
      skipped.push({ reason: "missing-hostname", detail: `Host ${alias}` });
      continue;
    }
    const jumpHostAlias = optionValue(options, "proxyJump")?.split(",")[0]?.trim() || undefined;
    if (jumpHostAlias) {
      referencedJumpAliases.add(jumpHostAlias);
    }
    hosts.push({
      alias,
      hostname,
      username: optionValue(options, "user")?.trim() ?? "",
      port: parsePort(optionValue(options, "port")),
      privateKeyPath: optionValue(options, "identityFile")?.trim() ?? "",
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
