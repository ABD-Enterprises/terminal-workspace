# Plan

## Goal

Term-Snip becomes the default terminal for cloud engineers — replacing Termius completely within 12-18 months. Not a connection manager. An execution platform where engineers actually do work: connect, run, reuse, collaborate, and audit.

## North Star

"The place where engineers actually do work — not just connect." Engineers open Term-Snip instead of Termius daily. Teams adopt shared command libraries. Sessions become reproducible. Audit logs become valuable artifacts.

## Core Principles

1. **Operator-first UX** — compact, dense, fast, keyboard-first, table/list driven, zero visual noise
2. **State is explicit** — every connection, command, session has visible state, no hidden context
3. **Everything is auditable** — every command loggable, replayable, attributable, FedRAMP-ready by default
4. **Local-first, cloud-aware** — works offline, enhances when connected
5. **No gimmick AI** — AI assists execution, suggestions explainable and traceable, no auto-execution ever

## Differentiation vs Termius

Termius = connection manager. Term-Snip = execution platform.

Outperform in: speed, multi-session workflows, team collaboration, command reuse, auditability, cloud-native workflows.

## Phases

### Phase 1: Terminal Core + Command System (S1-S4)
Replace Termius baseline: SSH, multi-session, environment grouping, structured command history, save/run commands.

### Phase 2: Cloud + Audit (S5-S7)
AWS EC2 integration, session recording, command-level audit logs, local audit system.

### Phase 3: Team + AI (S8-S10)
Shared environments, shared command library, session sharing, AI command assist.

## Constraints

- Build in vertical slices (end-to-end usable)
- Every feature usable within 1 minute
- No future placeholder features
- If it doesn't improve daily workflows, cut it
- Operator-first UX: no cards, no dashboards, no badge spam
- One task at a time, one PR per task (or batched related tasks)
