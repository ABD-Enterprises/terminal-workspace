#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

export const SIGNING_SECRET_NAMES = [
  "MACOS_CERTIFICATE_P12_BASE64",
  "MACOS_CERTIFICATE_PASSWORD",
  "MACOS_KEYCHAIN_PASSWORD",
  "MACOS_SIGN_IDENTITY",
];

export const NOTARY_API_KEY_SECRET_NAMES = [
  "MACOS_NOTARY_KEY_ID",
  "MACOS_NOTARY_ISSUER",
  "MACOS_NOTARY_KEY_BASE64",
];

export const NOTARY_APPLE_ID_SECRET_NAMES = [
  "MACOS_NOTARY_APPLE_ID",
  "MACOS_NOTARY_APP_PASSWORD",
  "MACOS_NOTARY_TEAM_ID",
];

export const ALL_RELEASE_SECRET_NAMES = [
  ...SIGNING_SECRET_NAMES,
  ...NOTARY_API_KEY_SECRET_NAMES,
  ...NOTARY_APPLE_ID_SECRET_NAMES,
];

function parseArgs(argv) {
  const [command = "audit", ...rest] = argv;
  const options = {
    command,
    json: false,
    dryRun: false,
    repo: process.env.GITHUB_REPOSITORY || "",
  };

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--json") {
      options.json = true;
      continue;
    }
    if (value === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (value === "--repo") {
      options.repo = rest[index + 1] ?? "";
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }

  return options;
}

export function parseSecretListOutput(stdout) {
  return new Set(
    stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/)[0]),
  );
}

export function readFileBase64(filePath) {
  return readFileSync(filePath).toString("base64");
}

export function detectDeveloperIdIdentity(runCommand = execFileSync) {
  const output = runCommand("security", ["find-identity", "-v", "-p", "codesigning"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const match = output.match(/"([^"]*Developer ID Application:[^"]*)"/);
  return match?.[1] ?? "";
}

function firstDefined(...values) {
  return values.find((value) => typeof value === "string" && value.length > 0) ?? "";
}

function resolveFileBackedSecret(env, keyNames, readBase64 = readFileBase64) {
  const direct = firstDefined(...keyNames.map((name) => env[name]));
  if (direct) {
    return direct;
  }

  const pathName = keyNames.find((name) => name.endsWith("_BASE64"))
    ? keyNames
        .map((name) => name.replace(/_BASE64$/, "_PATH"))
        .find((candidate) => env[candidate])
    : "";

  if (pathName && existsSync(env[pathName])) {
    return readBase64(env[pathName]);
  }

  return "";
}

export function resolveLocalReleaseSecretCandidates({
  env = process.env,
  detectIdentity = detectDeveloperIdIdentity,
  readBase64 = readFileBase64,
} = {}) {
  return {
    MACOS_CERTIFICATE_P12_BASE64: resolveFileBackedSecret(
      env,
      ["MACOS_CERTIFICATE_P12_BASE64", "MACOS_CERTIFICATE_P12_B64"],
      readBase64,
    ),
    MACOS_CERTIFICATE_PASSWORD: firstDefined(env.MACOS_CERTIFICATE_PASSWORD),
    MACOS_KEYCHAIN_PASSWORD: firstDefined(env.MACOS_KEYCHAIN_PASSWORD),
    MACOS_SIGN_IDENTITY: firstDefined(env.MACOS_SIGN_IDENTITY, detectIdentity()),
    MACOS_NOTARY_KEY_ID: firstDefined(env.MACOS_NOTARY_KEY_ID),
    MACOS_NOTARY_ISSUER: firstDefined(env.MACOS_NOTARY_ISSUER),
    MACOS_NOTARY_KEY_BASE64: resolveFileBackedSecret(
      env,
      ["MACOS_NOTARY_KEY_BASE64", "MACOS_NOTARY_KEY_B64"],
      readBase64,
    ),
    MACOS_NOTARY_APPLE_ID: firstDefined(env.MACOS_NOTARY_APPLE_ID, env.APPLE_ID),
    MACOS_NOTARY_APP_PASSWORD: firstDefined(
      env.MACOS_NOTARY_APP_PASSWORD,
      env.APPLE_APP_PASSWORD,
    ),
    MACOS_NOTARY_TEAM_ID: firstDefined(env.MACOS_NOTARY_TEAM_ID, env.APPLE_TEAM_ID, env.TEAM_ID),
  };
}

export function selectNotarySecretMode(secretValues) {
  const apiKeyMissing = NOTARY_API_KEY_SECRET_NAMES.filter((name) => !secretValues[name]);
  if (apiKeyMissing.length === 0) {
    return {
      mode: "api-key",
      requiredNames: NOTARY_API_KEY_SECRET_NAMES,
      missingNames: [],
    };
  }

  const appleIdMissing = NOTARY_APPLE_ID_SECRET_NAMES.filter((name) => !secretValues[name]);
  if (appleIdMissing.length === 0) {
    return {
      mode: "apple-id",
      requiredNames: NOTARY_APPLE_ID_SECRET_NAMES,
      missingNames: [],
    };
  }

  return {
    mode: "missing",
    requiredNames: [],
    missingNames: [
      ...NOTARY_API_KEY_SECRET_NAMES.filter((name) => !secretValues[name]),
      ...NOTARY_APPLE_ID_SECRET_NAMES.filter((name) => !secretValues[name]),
    ],
  };
}

export function buildReleaseSecretAudit({
  repoSecrets,
  localSecrets,
}) {
  const githubPresent = ALL_RELEASE_SECRET_NAMES.filter((name) => repoSecrets.has(name));
  const githubMissingSigning = SIGNING_SECRET_NAMES.filter((name) => !repoSecrets.has(name));

  const githubApiKeyMissing = NOTARY_API_KEY_SECRET_NAMES.filter((name) => !repoSecrets.has(name));
  const githubAppleIdMissing = NOTARY_APPLE_ID_SECRET_NAMES.filter((name) => !repoSecrets.has(name));

  const githubNotaryMode =
    githubApiKeyMissing.length === 0
      ? "api-key"
      : githubAppleIdMissing.length === 0
        ? "apple-id"
        : "missing";

  const localSigningMissing = SIGNING_SECRET_NAMES.filter((name) => !localSecrets[name]);
  const localNotary = selectNotarySecretMode(localSecrets);

  return {
    github: {
      present: githubPresent,
      missingSigning: githubMissingSigning,
      notaryMode: githubNotaryMode,
      missingNotary:
        githubNotaryMode === "missing"
          ? [...githubApiKeyMissing, ...githubAppleIdMissing]
          : [],
      ready: githubMissingSigning.length === 0 && githubNotaryMode !== "missing",
    },
    local: {
      present: ALL_RELEASE_SECRET_NAMES.filter((name) => Boolean(localSecrets[name])),
      missingSigning: localSigningMissing,
      notaryMode: localNotary.mode,
      missingNotary: localNotary.mode === "missing" ? localNotary.missingNames : [],
      ready: localSigningMissing.length === 0 && localNotary.mode !== "missing",
    },
  };
}

export function validateLocalReleaseSecrets({
  env = process.env,
  detectIdentity = detectDeveloperIdIdentity,
  readBase64 = readFileBase64,
} = {}) {
  const localSecrets = resolveLocalReleaseSecretCandidates({
    env,
    detectIdentity,
    readBase64,
  });
  const localSigningMissing = SIGNING_SECRET_NAMES.filter((name) => !localSecrets[name]);
  const localNotary = selectNotarySecretMode(localSecrets);

  return {
    present: ALL_RELEASE_SECRET_NAMES.filter((name) => Boolean(localSecrets[name])),
    missingSigning: localSigningMissing,
    notaryMode: localNotary.mode,
    missingNotary: localNotary.mode === "missing" ? localNotary.missingNames : [],
    ready: localSigningMissing.length === 0 && localNotary.mode !== "missing",
  };
}

function runGh(args, input) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    input,
    stdio: input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
  });
}

function resolveRepoName(repo) {
  if (repo) {
    return repo;
  }

  return runGh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
}

export function auditReleaseSecrets({
  repo = process.env.GITHUB_REPOSITORY || "",
  env = process.env,
  runSecretList = (repoName) => runGh(["secret", "list", "--repo", repoName]),
  detectIdentity = detectDeveloperIdIdentity,
  readBase64 = readFileBase64,
} = {}) {
  const repoName = resolveRepoName(repo);
  const repoSecrets = parseSecretListOutput(runSecretList(repoName));
  const localSecrets = resolveLocalReleaseSecretCandidates({
    env,
    detectIdentity,
    readBase64,
  });

  return {
    repo: repoName,
    ...buildReleaseSecretAudit({ repoSecrets, localSecrets }),
  };
}

export function applyReleaseSecretsFromEnv({
  repo = process.env.GITHUB_REPOSITORY || "",
  env = process.env,
  dryRun = false,
  setSecret = (repoName, name, value) =>
    runGh(["secret", "set", name, "--repo", repoName, "--body", value]),
  detectIdentity = detectDeveloperIdIdentity,
  readBase64 = readFileBase64,
} = {}) {
  const repoName = resolveRepoName(repo);
  const localSecrets = resolveLocalReleaseSecretCandidates({
    env,
    detectIdentity,
    readBase64,
  });

  const signingMissing = SIGNING_SECRET_NAMES.filter((name) => !localSecrets[name]);
  const notary = selectNotarySecretMode(localSecrets);

  if (signingMissing.length > 0 || notary.mode === "missing") {
    const missing = [
      ...signingMissing,
      ...(notary.mode === "missing"
        ? ["notary credentials (App Store Connect key triple or Apple ID/app password/team ID)"]
        : []),
    ];
    const error = new Error(
      `Cannot apply release secrets from local environment. Missing: ${missing.join(", ")}`,
    );
    error.code = "MISSING_LOCAL_SECRETS";
    throw error;
  }

  const appliedNames = [...SIGNING_SECRET_NAMES, ...notary.requiredNames];

  if (!dryRun) {
    for (const name of appliedNames) {
      setSecret(repoName, name, localSecrets[name]);
    }
  }

  return {
    repo: repoName,
    dryRun,
    notaryMode: notary.mode,
    appliedNames,
  };
}

function printHumanAudit(audit) {
  console.log(`Repository: ${audit.repo}`);
  console.log(`GitHub signing secrets ready: ${audit.github.ready ? "yes" : "no"}`);
  if (audit.github.missingSigning.length > 0) {
    console.log(`Missing GitHub signing secrets: ${audit.github.missingSigning.join(", ")}`);
  }
  console.log(`GitHub notary mode: ${audit.github.notaryMode}`);
  if (audit.github.missingNotary.length > 0) {
    console.log(`Missing GitHub notary secrets: ${audit.github.missingNotary.join(", ")}`);
  }
  console.log(`Local secret candidates ready: ${audit.local.ready ? "yes" : "no"}`);
  if (audit.local.missingSigning.length > 0) {
    console.log(`Missing local signing inputs: ${audit.local.missingSigning.join(", ")}`);
  }
  console.log(`Local notary mode: ${audit.local.notaryMode}`);
  if (audit.local.missingNotary.length > 0) {
    console.log(`Missing local notary inputs: ${audit.local.missingNotary.join(", ")}`);
  }
}

function printHumanLocalValidation(result) {
  console.log(`Local signing secrets ready: ${result.missingSigning.length === 0 ? "yes" : "no"}`);
  if (result.missingSigning.length > 0) {
    console.log(`Missing local signing inputs: ${result.missingSigning.join(", ")}`);
  }
  console.log(`Local notary mode: ${result.notaryMode}`);
  if (result.missingNotary.length > 0) {
    console.log(`Missing local notary inputs: ${result.missingNotary.join(", ")}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.command === "audit") {
    const audit = auditReleaseSecrets({ repo: options.repo });
    if (options.json) {
      console.log(JSON.stringify(audit, null, 2));
    } else {
      printHumanAudit(audit);
    }
    process.exitCode = audit.github.ready ? 0 : 1;
    return;
  }

  if (options.command === "validate-env") {
    const result = validateLocalReleaseSecrets();
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHumanLocalValidation(result);
    }
    process.exitCode = result.ready ? 0 : 1;
    return;
  }

  if (options.command === "apply-env") {
    const result = applyReleaseSecretsFromEnv({
      repo: options.repo,
      dryRun: options.dryRun,
    });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(
        `${result.dryRun ? "Would apply" : "Applied"} release secrets for ${result.repo}: ${result.appliedNames.join(", ")}`,
      );
    }
    return;
  }

  throw new Error(`Unsupported command: ${options.command}`);
}

if (import.meta.url === new URL(`file://${path.resolve(process.argv[1] || "")}`).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
