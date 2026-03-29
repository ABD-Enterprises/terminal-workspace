# Terminal Workspace

A local-first macOS SSH client starter repo inspired by the usability patterns of Termius.

## Goals
- Practical 90% daily-use feature parity
- Native-feeling macOS desktop experience
- Local-first storage and secrets handling
- Fast terminal workflows with tabs, splits, SFTP, snippets, and forwarding

## Initial Scope
- Hosts
- SSH sessions
- Tabs and splits
- Keys
- SFTP
- Snippets
- Forwarding
- Session restore

## Deferred
- Cloud sync
- Team collaboration
- Multiplayer sessions

## Native Validation
- `pnpm native:icons` generates the Tauri icon set from `apps/desktop/public/favicon.svg`
- `pnpm native:check` regenerates icons and runs `cargo check --manifest-path src-tauri/Cargo.toml`
- `pnpm native:build` regenerates icons and runs `cargo build --manifest-path src-tauri/Cargo.toml`
