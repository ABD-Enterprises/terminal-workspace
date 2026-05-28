import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isTracked, stagePath } from "./git.mjs";

export const LOCAL_ADAPTER_BEGIN = "<!-- BEGIN ENTERPRISE-AI-STANDARDS LOCAL ADAPTER -->";
export const LOCAL_ADAPTER_END = "<!-- END ENTERPRISE-AI-STANDARDS LOCAL ADAPTER -->";

export const LOCAL_ADAPTERS = [
  {
    path: "AGENTS.md",
    tool: "Codex",
  },
  {
    path: "CLAUDE.md",
    tool: "Claude",
  },
  {
    path: ".agent/rules.md",
    tool: "Antigravity",
  },
];

function adapterContent(tool) {
  return `# Enterprise AI Adapter (${tool})

${LOCAL_ADAPTER_BEGIN}

This repo is adopted into Enterprise AI Standards.

Source of truth:

- Board and provider: \`.ai/config.json\`
- Task state: external ticket board, not repo markdown
- Runtime CLI: \`ai-pipeline\`
- Shared skills: local agent skill roots linked from Enterprise AI Standards by BrewSync
- Subagent roster: \`ai/subagents.json\` in the standards repo; adopted repos inherit it through EAS policy, not by copying it locally

Startup:

- **Pick a role-scoped reading list** from \`docs/eas-loading-guide.md\` in the standards repo before reading \`enterprise-ai-standards.md\`. Loading the full standard wastes ~40K tokens for non-operator sessions; the guide names which §sections each role needs (planner / builder / reviewer / finisher / adopter / operator).
- If the branch contains a ticket id, run \`ai-pipeline current\`. If on \`main\` / \`master\` or no ticket id, run \`ai-pipeline next\` before implementing. If the operator is asking for new work and no ticket exists, run \`ai-pipeline plan "<title>"\`.
- Read ticket comments with \`ai-pipeline comments\` (default: structured-metadata only; \`--all\` opts into full thread). Read diffs with \`ai-pipeline diff\` (lockfiles / generated / vendor stripped; 200KB cap). Never re-fetch raw thread or raw diff into the agent context.
- Search before broad reads: use \`rg\`, targeted provider queries, or deterministic CLI commands to locate the exact symbol, config, or ticket evidence before opening large files/directories. Read only the surrounding lines needed, and stop exploration once the next safe implementation step is clear.
- Prefer shared EAS skills for repo intake, git hygiene, validation, PR response, token conservation, churn avoidance, and multi-Mac workflow.
- For read-heavy or synthesis-light work, delegate to subscription-backed cloud subagents per the §A13 roster (Codex subscription helpers preferred for GitHub-API work). Subagent prompts MUST carry role, read-only guardrails, scoped task, and expected output format. Synthesize multi-helper output with Lagrange before editing. Local helpers only when cloud runtime is unavailable, the work touches local-only files, secrets, or unpushed worktrees.
- Treat \`ai-pipeline claim\` / \`next\` continuity notices as startup inputs: honor model-tier recommendations, repair skill-sync drift when reported, source MCP credentials through §D7 \`cred.sh\`.

Hard rules:

- AI task state lives on the external board only. Do not use \`docs/roadmap\`, \`state/\`, \`work.json\`, \`state.json\`, \`markdown.json\`, or markdown task lists.
- Canonical states: \`ready_for_work\` = unclaimed impl; \`in_development\` = active impl lease; \`ready_for_local_testing\` = cloud-completed handoff; \`in_local_testing\` = local-validation lease. Cloud agents may transition to \`ready_for_local_testing\`; local machines pick up with \`ai-pipeline validate-next\`.
- Cloud/container agents run advisory \`validation.cloud_preflight\` checks only. Do not open a PR or transition to \`in_pr_review\` until local validation has passed. Production deploys stay on protected CI or trusted local runners; cloud containers may only do preview/sandbox deploys unless the repo explicitly documents trusted-cloud.
- Local validation mirrors CI-required flags as closely as practical; CI failures override local assumptions. Validation scripts tolerate unset optional env vars under \`set -u\`. \`ai-pipeline validate\` base-freshness failures are blockers — rebase onto the named target and rerun before pushing.
- Run local validation before pushing; inspect failed check logs; rerun CI only for concrete infra/cancellation/flaky-test reasons. Before \`gh pr merge --auto\`, use \`tools/check-auto-merge-prereqs.sh\` so branches without required status checks cannot merge vacuously.
- Before editing any source file, search the issue tracker for the filename and the pattern you are about to add or change; pause and coordinate if an open issue is already refactoring that file or removing that pattern.
- Enforce zero bad churn: keep edits scoped to the ticket/root cause, preserve the touched file's established style, avoid drive-by formatting/import sorting/public API renames, and do not commit scratch harnesses, IDE dotfiles, or agent-specific utility scripts unless the ticket explicitly requires them.
- Treat push as remote verification, not iterative debugging: run the ticket's \`validation.local\` commands and cheap PR-essential/changelog validators before the first push whenever the repo provides them; if remote CI fails, inspect logs and reproduce locally before another push or rerun.
- Budget-preflight notices from \`ai-pipeline claim\` / \`next\` are launch constraints: REDUCED → downshift + tighten tool scope; DEGRADED → finish only in-flight work at Mechanical tier; HALT → cadence stops unless explicitly overridden. Provider 429/503/overloaded responses follow §F7: record event, run \`ai-pipeline rate-budget check\`, downshift, bounded backoff, then escalate with terminal evidence.
- Keep git identity aligned with §F6: \`+<host>\` email aliases for commits; \`Co-Authored-By: <Agent> (<host>) ...\` trailers for agents. Rerun \`tools/ai-pipeline/scripts/install-host-identity.sh --host <host>\` when adopt reports drift.
- Run configured local-first reviews before CI spend when \`.ai/config.json#local_review\` declares them. Track actionable local-review findings in GitHub Issues, not markdown logs.
- In-session subagents extend hands, not leases: they may search, read, inspect, summarize, classify, and report — they must NOT claim/transition tickets, add evidence, push, open/comment/merge PRs, or mutate provider state. Do not paste raw subagent transcripts into tickets, PRs, or commits; extract verified facts.
- Before local validation, pre-push, or other expensive milestones, respect the board-state heartbeat; stop if the ticket is blocked, reassigned, or no longer in the active state for this session.
- Do not commit shared skills (BrewSync owns machine-local linking) or local lease/controller/planner/handoff state files. \`.ai/\` is local-only. This adapter is tracked so fresh clones discover the EAS contract; repo-specific guidance lives outside the managed block (\`ai-pipeline adopt --force\` preserves it).
- "Get latest" means update this repo only: \`git fetch origin --prune && git pull --ff-only\`.

${LOCAL_ADAPTER_END}
`;
}

export function isManagedAdapterContent(content) {
  return content.includes(LOCAL_ADAPTER_BEGIN) && content.includes(LOCAL_ADAPTER_END);
}

function replaceManagedBlock(current, next) {
  const begin = current.indexOf(LOCAL_ADAPTER_BEGIN);
  const end = current.indexOf(LOCAL_ADAPTER_END);
  if (begin === -1 || end === -1 || end < begin) return next;

  const afterEnd = end + LOCAL_ADAPTER_END.length;
  const nextBegin = next.indexOf(LOCAL_ADAPTER_BEGIN);
  const nextEnd = next.indexOf(LOCAL_ADAPTER_END) + LOCAL_ADAPTER_END.length;
  return `${current.slice(0, begin)}${next.slice(nextBegin, nextEnd)}${current.slice(afterEnd)}`;
}

function managedBlock(content) {
  const begin = content.indexOf(LOCAL_ADAPTER_BEGIN);
  const end = content.indexOf(LOCAL_ADAPTER_END);
  if (begin === -1 || end === -1 || end < begin) return "";
  return content.slice(begin, end + LOCAL_ADAPTER_END.length);
}

function summarizeManagedDiff(current, next) {
  const a = managedBlock(current).split("\n");
  const b = managedBlock(next).split("\n");
  if (a.join("\n") === b.join("\n")) return null;
  let added = 0;
  let removed = 0;
  for (const line of b) if (!a.includes(line)) added += 1;
  for (const line of a) if (!b.includes(line)) removed += 1;
  return { added, removed };
}

export function installLocalAdapters(repoRootDir, { force = false } = {}) {
  const installed = [];
  const skipped = [];
  const conflicts = [];
  const previews = [];

  for (const adapter of LOCAL_ADAPTERS) {
    const absolutePath = resolve(repoRootDir, adapter.path);
    const next = adapterContent(adapter.tool);
    let body = next;

    if (existsSync(absolutePath)) {
      const current = readFileSync(absolutePath, "utf8");
      if (!isManagedAdapterContent(current) && !force) {
        conflicts.push(`${adapter.path} (unmanaged adapter file exists; merge it or rerun with --force)`);
        continue;
      }
      if (isManagedAdapterContent(current)) {
        const preview = summarizeManagedDiff(current, next);
        if (preview) previews.push(`${adapter.path} (+${preview.added}/-${preview.removed} managed lines)`);
        body = replaceManagedBlock(current, next);
      }
    }

    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, body, "utf8");
    stagePath(repoRootDir, adapter.path);
    installed.push(adapter.path);
  }

  return { installed, skipped, conflicts, previews };
}

export function removeLocalAdapters(repoRootDir) {
  const removed = [];
  const skipped = [];

  for (const adapter of LOCAL_ADAPTERS) {
    const absolutePath = resolve(repoRootDir, adapter.path);

    if (!existsSync(absolutePath)) continue;
    if (isTracked(repoRootDir, adapter.path)) {
      skipped.push(`${adapter.path} (tracked file exists)`);
      continue;
    }

    const current = readFileSync(absolutePath, "utf8");
    if (!isManagedAdapterContent(current)) {
      skipped.push(`${adapter.path} (unmanaged local file exists)`);
      continue;
    }

    rmSync(absolutePath, { force: true });
    removed.push(adapter.path);
  }

  const agentDir = resolve(repoRootDir, ".agent");
  if (existsSync(agentDir) && readdirSync(agentDir).length === 0) {
    rmSync(agentDir, { recursive: true, force: true });
  }

  return { removed, skipped };
}
