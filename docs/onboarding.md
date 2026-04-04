# Onboarding

## First Run

1. Run `npm run setup`
2. Run `npm run dev` for the browser/demo workspace or `npm run native:check` for the native shell
3. Open Settings and confirm whether you want demo mode or live native transport

## What To Learn First

- `apps/desktop/src/lib/api.ts`: frontend transport seam
- `src-tauri/src/native_transport.rs`: native SSH, SFTP, forwarding, snippets, and trust tooling
- `src-tauri/src/keychain_support.rs`: native runtime secret persistence
- `docs/roadmap/roadmap.md`: current milestone and next phase

## Safe Defaults

- Use demo mode for screenshots and seeded UI review.
- Use the native shell for real SSH, trust, and secret-storage checks.
- Run `npm run native:trust` before changing native key or trust behavior.
