export interface ImportedSshConfigHost {
  alias: string;
  hostname: string;
  username: string;
  port: number;
  privateKeyPath: string;
  jumpHostAlias?: string;
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

export function parseSshConfig(text: string) {
  const lines = text.split(/\r?\n/);
  const globalOptions: ParsedSshConfigOptions = {};
  let currentAliases: string[] = [];
  let currentOptions: ParsedSshConfigOptions = {};
  const aliasMap = new Map<string, ParsedSshConfigOptions>();

  const flushCurrentBlock = () => {
    if (!currentAliases.length) {
      return;
    }

    currentAliases.forEach((alias) => {
      const existing = aliasMap.get(alias);
      aliasMap.set(alias, mergeOptions(existing, currentOptions));
    });
  };

  lines.forEach((rawLine) => {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const directiveMatch = rawLine.match(/^\s*([A-Za-z][A-Za-z0-9]*)\s+(.*)$/);
    if (!directiveMatch) {
      return;
    }

    const [, rawDirective, rawValue] = directiveMatch;
    const directive = rawDirective.toLowerCase();
    const value = normalizeDirectiveValue(rawValue);

    if (!value) {
      return;
    }

    if (directive === "match" || directive === "include") {
      return;
    }

    if (directive === "host") {
      flushCurrentBlock();
      currentAliases = value
        .split(/\s+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .filter((alias) => !isWildcardAlias(alias));
      currentOptions = { ...globalOptions };
      return;
    }

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

  return Array.from(aliasMap.entries())
    .map(([alias, options]) => {
      const hostname = options.hostname?.trim() || alias;

      return {
        alias,
        hostname,
        username: options.user?.trim() ?? "",
        port: parsePort(options.port),
        privateKeyPath: options.identityFile?.trim() ?? "",
        jumpHostAlias: options.proxyJump?.split(",")[0]?.trim() || undefined,
      } satisfies ImportedSshConfigHost;
    })
    .filter((entry) => Boolean(entry.alias) && Boolean(entry.hostname))
    .sort((left, right) => left.alias.localeCompare(right.alias));
}

