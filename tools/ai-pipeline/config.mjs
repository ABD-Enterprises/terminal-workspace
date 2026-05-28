import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const CANONICAL_STATES = [
  "backlog",
  "in_refinement",
  "ready_for_work",
  "in_development",
  "ready_for_local_testing",
  "in_local_testing",
  "in_pr_review",
  "changes_requested",
  "blocked",
  "done",
];

const OPTIONAL_CANONICAL_STATES = [];

const ALL_CANONICAL_STATES = [...CANONICAL_STATES, ...OPTIONAL_CANONICAL_STATES];

const SUPPORTED_PROVIDERS = ["github", "jira", "linear"];
// `snyk` was removed in v7.10.0 — paid tier cost unjustified at the fleet's
// scale, free tier monthly caps unusable. The replacement OSS stack
// (Trivy + OSV-Scanner + Syft + Grype) is invoked via per-repo
// scripts/validate.sh per §C1, not as a canonical `local_review.tools` key.
// Repos still declaring `snyk` in `.ai/config.json#local_review.tools` will
// fail `validateConfig` with a clear "removed; see §A9" message.
const LOCAL_REVIEW_TOOLS = [
  "gemini_cli",
  "sonarqube_docker",
  "qwen_lmstudio",
];
const LOCAL_REVIEW_OUTPUT_KINDS = ["ai_review", "scan", "report"];
// Accepted models for AI-assisted local review tools. Short aliases (flash,
// pro) map onto Gemini's current 2.5 family; full IDs are also accepted so a
// repo can pin a specific version. New aliases get added here as Google ships
// them — keep the list short.
const LOCAL_REVIEW_MODELS = [
  "flash",
  "pro",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
];
const CLOUD_EXECUTION_ALLOWED_COMMANDS = [
  "format",
  "lint",
  "typecheck",
  "unit",
  "scan",
  "ai_review",
  "preview_deploy",
];
const CLOUD_EXECUTION_FORBIDDEN_DEFAULTS = [
  "production_deploy",
  "secret_export",
  "local_validation_substitute",
];

export function configPath(repoRoot) {
  const sourceConfig = resolve(repoRoot, "ai/config.json");
  const adoptedConfig = resolve(repoRoot, ".ai/config.json");

  if (existsSync(sourceConfig) && isStandardsSourceRepo(repoRoot)) {
    return sourceConfig;
  }
  if (existsSync(adoptedConfig)) {
    return adoptedConfig;
  }
  return existsSync(sourceConfig) ? sourceConfig : undefined;
}

export function loadConfig(repoRoot) {
  const path = configPath(repoRoot);
  if (!path) {
    throw new Error(
      `No board config found. Expected .ai/config.json (adopted repo) or ai/config.json (this standards repo).`,
    );
  }
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return { path, ...validateConfig(raw, path) };
}

export function validateConfig(cfg, sourcePath) {
  const errors = [];

  if (cfg.schema_version !== 1) {
    errors.push(`schema_version must be 1 (got ${cfg.schema_version})`);
  }

  if (!cfg.board || typeof cfg.board !== "object") {
    errors.push("board must be an object");
  } else {
    if (!SUPPORTED_PROVIDERS.includes(cfg.board.type)) {
      errors.push(
        `board.type must be one of ${SUPPORTED_PROVIDERS.join(", ")} (got ${cfg.board.type})`,
      );
    }
    if (typeof cfg.board.project !== "string" || !cfg.board.project) {
      errors.push("board.project is required");
    }
    if (typeof cfg.board.auth_env !== "string" || !cfg.board.auth_env) {
      errors.push("board.auth_env is required");
    }
  }

  if (!cfg.state_map || typeof cfg.state_map !== "object") {
    errors.push("state_map must be an object");
  } else {
    for (const state of CANONICAL_STATES) {
      if (typeof cfg.state_map[state] !== "string" || !cfg.state_map[state]) {
        errors.push(`state_map.${state} is required`);
      }
    }
    for (const state of OPTIONAL_CANONICAL_STATES) {
      if (state in cfg.state_map) {
        if (typeof cfg.state_map[state] !== "string" || !cfg.state_map[state]) {
          errors.push(`state_map.${state} must be a non-empty string when present`);
        }
      }
    }
  }

  if (!["solo", "strict"].includes(cfg.execution_mode)) {
    errors.push(`execution_mode must be "solo" or "strict" (got ${cfg.execution_mode})`);
  }

  if (!cfg.evidence || typeof cfg.evidence !== "object") {
    errors.push("evidence must be an object");
  }

  validateLocalReviewConfig(cfg.local_review, errors);
  validateCloudExecutionConfig(cfg.cloud_execution, errors);
  validateCadenceConfig(cfg.cadence, errors);

  if (
    cfg.cadence_control_issue !== undefined &&
    (typeof cfg.cadence_control_issue !== "string" || !cfg.cadence_control_issue.trim())
  ) {
    errors.push("cadence_control_issue must be a non-empty string when present");
  }

  if (errors.length) {
    throw new Error(
      `Invalid config at ${sourcePath}:\n  - ${errors.join("\n  - ")}`,
    );
  }
  return cfg;
}

export {
  ALL_CANONICAL_STATES,
  CANONICAL_STATES,
  CLOUD_EXECUTION_ALLOWED_COMMANDS,
  CLOUD_EXECUTION_FORBIDDEN_DEFAULTS,
  LOCAL_REVIEW_MODELS,
  LOCAL_REVIEW_OUTPUT_KINDS,
  LOCAL_REVIEW_TOOLS,
  OPTIONAL_CANONICAL_STATES,
  SUPPORTED_PROVIDERS,
};

function validateLocalReviewConfig(localReview, errors) {
  if (localReview === undefined) return;
  if (!localReview || typeof localReview !== "object" || Array.isArray(localReview)) {
    errors.push("local_review must be an object when present");
    return;
  }

  if (
    localReview.mode !== undefined &&
    !["advisory", "required"].includes(localReview.mode)
  ) {
    errors.push(`local_review.mode must be "advisory" or "required" (got ${localReview.mode})`);
  }

  if (localReview.allowed_directories !== undefined) {
    if (!Array.isArray(localReview.allowed_directories)) {
      errors.push("local_review.allowed_directories must be an array");
    } else {
      for (const dir of localReview.allowed_directories) {
        if (typeof dir !== "string" || !dir || dir.startsWith("/") || dir.includes("..")) {
          errors.push(
            `local_review.allowed_directories entries must be non-empty repo-relative directories (got ${JSON.stringify(dir)})`,
          );
        }
      }
    }
  }

  if (!localReview.tools || typeof localReview.tools !== "object" || Array.isArray(localReview.tools)) {
    errors.push("local_review.tools must be an object when local_review is present");
    return;
  }

  for (const [name, tool] of Object.entries(localReview.tools)) {
    if (name === "snyk") {
      // Removed in v7.10.0 — point to the §A9 explanation rather than the
      // generic "not supported" message so the operator knows it's an
      // intentional removal, not a typo.
      errors.push(
        `local_review.tools.snyk was removed in v7.10.0 (paid-tier cost / free-tier cap unusable at fleet scale). The OSS replacement stack (Trivy + OSV-Scanner + Syft + Grype) is invoked via scripts/validate.sh per §C1, not as a local_review.tools key. Remove this entry from .ai/config.json. See enterprise-ai-standards.md §A9.`,
      );
      continue;
    }
    if (!LOCAL_REVIEW_TOOLS.includes(name)) {
      errors.push(
        `local_review.tools.${name} is not supported; valid tools: ${LOCAL_REVIEW_TOOLS.join(", ")}`,
      );
      continue;
    }
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      errors.push(`local_review.tools.${name} must be an object`);
      continue;
    }
    if (typeof tool.enabled !== "boolean") {
      errors.push(`local_review.tools.${name}.enabled must be boolean`);
    }
    if (tool.required !== undefined && typeof tool.required !== "boolean") {
      errors.push(`local_review.tools.${name}.required must be boolean when present`);
    }
    if (tool.output_kind !== undefined && !LOCAL_REVIEW_OUTPUT_KINDS.includes(tool.output_kind)) {
      errors.push(
        `local_review.tools.${name}.output_kind must be one of ${LOCAL_REVIEW_OUTPUT_KINDS.join(", ")}`,
      );
    }
    if (
      ["gemini_cli", "qwen_lmstudio"].includes(name) &&
      tool.output_kind !== undefined &&
      tool.output_kind !== "ai_review"
    ) {
      errors.push(`local_review.tools.${name}.output_kind must be "ai_review"`);
    }
    // Model selection — only meaningful for AI-assisted tools today, but accept
    // the field on any tool so a future scanner with model knobs doesn't need
    // another schema bump. Reject unknown values.
    if (tool.model !== undefined) {
      if (typeof tool.model !== "string" || !LOCAL_REVIEW_MODELS.includes(tool.model)) {
        errors.push(
          `local_review.tools.${name}.model must be one of ${LOCAL_REVIEW_MODELS.join(", ")}`,
        );
      }
    }
    // Risk-tiered escalation — when true, the tool's local-first run uses the
    // cheap default (Flash) and only escalates to the heavier model (Pro) when
    // EAS Risk Label flagged the PR risk:medium or risk:high.
    if (tool.auto_escalate_on_risk !== undefined && typeof tool.auto_escalate_on_risk !== "boolean") {
      errors.push(
        `local_review.tools.${name}.auto_escalate_on_risk must be boolean when present`,
      );
    }
    if (tool.evidence !== undefined) {
      if (!Array.isArray(tool.evidence)) {
        errors.push(`local_review.tools.${name}.evidence must be an array when present`);
      } else {
        for (const ref of tool.evidence) {
          if (typeof ref !== "string" || !ref) {
            errors.push(`local_review.tools.${name}.evidence entries must be non-empty strings`);
          }
        }
      }
    }
  }
}

function validateCloudExecutionConfig(cloudExecution, errors) {
  if (cloudExecution === undefined) return;
  if (!cloudExecution || typeof cloudExecution !== "object" || Array.isArray(cloudExecution)) {
    errors.push("cloud_execution must be an object when present");
    return;
  }

  if (typeof cloudExecution.enabled !== "boolean") {
    errors.push("cloud_execution.enabled must be boolean");
  }

  const container = cloudExecution.container;
  if (container !== undefined) {
    if (!container || typeof container !== "object" || Array.isArray(container)) {
      errors.push("cloud_execution.container must be an object when present");
    } else {
      if (container.image !== undefined && (typeof container.image !== "string" || !container.image)) {
        errors.push("cloud_execution.container.image must be a non-empty string when present");
      }
      if (container.setup !== undefined) {
        if (!Array.isArray(container.setup)) {
          errors.push("cloud_execution.container.setup must be an array when present");
        } else {
          for (const cmd of container.setup) {
            if (typeof cmd !== "string" || !cmd) {
              errors.push("cloud_execution.container.setup entries must be non-empty strings");
            }
          }
        }
      }
    }
  }

  if (cloudExecution.allowed_commands !== undefined) {
    if (!Array.isArray(cloudExecution.allowed_commands)) {
      errors.push("cloud_execution.allowed_commands must be an array when present");
    } else {
      for (const item of cloudExecution.allowed_commands) {
        if (!CLOUD_EXECUTION_ALLOWED_COMMANDS.includes(item)) {
          errors.push(
            `cloud_execution.allowed_commands contains unsupported value ${JSON.stringify(item)}; valid values: ${CLOUD_EXECUTION_ALLOWED_COMMANDS.join(", ")}`,
          );
        }
      }
    }
  }

  if (cloudExecution.forbidden !== undefined) {
    if (!Array.isArray(cloudExecution.forbidden)) {
      errors.push("cloud_execution.forbidden must be an array when present");
    } else {
      for (const item of cloudExecution.forbidden) {
        if (typeof item !== "string" || !item) {
          errors.push("cloud_execution.forbidden entries must be non-empty strings");
        }
      }
    }
  }
}

function validateCadenceConfig(cadence, errors) {
  if (cadence === undefined) return;
  if (!cadence || typeof cadence !== "object" || Array.isArray(cadence)) {
    errors.push("cadence must be an object when present");
    return;
  }

  const keyRe = /^(hourly|daily|weekly|monthly):[a-z0-9-]+$/;
  const requiredStrings = ["selector", "action", "completion_signal"];
  const nonNegativeLimits = ["creation_hourly_limit", "ci_hourly_limit"];
  const positiveLimits = ["concurrent_limit", "max_runtime_minutes", "max_iterations", "max_claims_per_run"];
  const allowedFields = new Set([
    ...requiredStrings,
    ...nonNegativeLimits,
    ...positiveLimits,
  ]);

  for (const [name, task] of Object.entries(cadence)) {
    if (!keyRe.test(name)) {
      errors.push(`cadence.${name} must match <hourly|daily|weekly|monthly>:<task-slug>`);
    }
    if (!task || typeof task !== "object" || Array.isArray(task)) {
      errors.push(`cadence.${name} must be an object`);
      continue;
    }
    for (const key of Object.keys(task)) {
      if (!allowedFields.has(key)) {
        errors.push(`cadence.${name}.${key} is not supported`);
      }
    }
    for (const key of requiredStrings) {
      if (typeof task[key] !== "string" || !task[key]) {
        errors.push(`cadence.${name}.${key} must be a non-empty string`);
      }
    }
    for (const key of nonNegativeLimits) {
      if (!Number.isInteger(task[key]) || task[key] < 0) {
        errors.push(`cadence.${name}.${key} must be a non-negative integer`);
      }
    }
    if (!Number.isInteger(task.concurrent_limit) || task.concurrent_limit < 1) {
      errors.push(`cadence.${name}.concurrent_limit must be a positive integer`);
    }
    for (const key of positiveLimits.filter((k) => k !== "concurrent_limit")) {
      if (task[key] !== undefined && (!Number.isInteger(task[key]) || task[key] < 1)) {
        errors.push(`cadence.${name}.${key} must be a positive integer when present`);
      }
    }
  }
}

function isStandardsSourceRepo(repoRoot) {
  return (
    existsSync(resolve(repoRoot, "enterprise-ai-standards.md")) &&
    existsSync(resolve(repoRoot, "tools/ai-pipeline/cli.mjs"))
  );
}
