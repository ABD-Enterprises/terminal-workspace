# Validation Log

## 2026-04-04

### Release Credential Portability And Regression Hardening

- `npm run native:notary:auth:test`
  - validated App Store Connect key auth resolution
  - validated Apple ID auth resolution
  - validated local keychain-profile auth resolution
- `bash ./scripts/native-fixture-preflight.sh trust`
  - confirmed the local shell can launch and scan a temporary localhost `sshd`
- `npm run native:fixtures`
  - preflight passed
  - `native_transport_fixtures::localhost_ssh_transport_fixture_flow` passed
- `npm run native:release:check`
  - rebuilt the signed bundle after the portability changes
  - manifest now includes artifact basenames and relative paths
- `MACOS_NOTARY_PROFILE=BugNarratorNotary npm run native:notarize`
  - accepted Apple submission `fdbe1c4b-27a6-47fe-a726-ddaa01cfb723`
  - after the auth dry-run addition, accepted Apple submission `c7f60fa5-9560-4f94-894c-f399f0afbc6e`
  - stapling passed
  - post-notary `spctl` reported `accepted`
- `npm run native:promote`
  - wrote promoted release notes and updated the stable manifest
- `npm run native:publish:dry-run`
  - validated the promoted GitHub release asset list and release-note path
- `TERMSNIP_RUN_E2E=1 npm run validate`
  - passed after the parity tests, vault snapshot metadata, and fixture preflight changes
  - Vitest passed 12 files and 39 tests
  - desktop production build passed
  - `native_transport_fixtures::native_trust_tooling_fixture_flow` passed with preflight
  - Playwright passed 5 route and workflow specs

### Notarization And Release Promotion

- `MACOS_NOTARY_PROFILE=BugNarratorNotary npm run native:notarize`
  - Apple notarization submission `cdcc26c4-de7c-46c3-9908-fffee66dfd7f` accepted during the first
    local proof pass
  - after the implementation commit, Apple notarization submission
    `0a91fc93-73af-4f5b-b41c-4def1ee41594` accepted on the committed release automation
  - stapling passed
  - post-notary `spctl` reported `accepted`
- `npm run native:promote`
  - promoted the notarized artifact into `artifacts/release/promoted/stable/v0.1.0`
- `xcrun stapler validate -v src-tauri/target/release/bundle/macos/Terminal Workspace.app`
  - passed after notarization
- `spctl --assess --type execute --verbose=4 src-tauri/target/release/bundle/macos/Terminal Workspace.app`
  - reported `accepted`
- `TERMSNIP_RUN_E2E=1 npm run validate`
  - passed after the notarization/promotion implementation commit

### Packaging And Release Hardening

- `MACOS_SIGN_MODE=skip npm run native:release:check`
  - built the native bundle, wrote the versioned zip plus JSON manifest, and verified the preview
    packaging path
- `npm run native:release:check`
  - built the signed native bundle with `MACOS_SIGN_MODE=require`
  - confirmed the final manifest now reports `com.abdenterprises.terminalworkspace`
  - `codesign` verification passed
  - `spctl` assessment returned `not_accepted`, which is now tracked as the notarization blocker
- `TERMSNIP_RUN_E2E=1 npm run validate` from an unsandboxed shell
  - Vitest passed 12 files and 33 tests
  - desktop production build passed
  - `native_transport_fixtures::native_trust_tooling_fixture_flow` passed
  - Playwright passed 5 route and workflow specs

### Passed

- `npm run native:check`
- `npm run native:key`
  - `native_transport_fixtures::native_key_tooling_fixture_flow` passed
- `bash ./scripts/native-trust-tooling-test.sh` from an unsandboxed shell
  - `native_transport_fixtures::native_trust_tooling_fixture_flow` passed
- `npm run native:fixtures` from an unsandboxed shell
  - `native_transport_fixtures::localhost_ssh_transport_fixture_flow` passed
- `TERMSNIP_RUN_E2E=1 npm run validate` from an unsandboxed shell
  - Vitest passed 12 files and 33 tests
  - desktop production build passed
  - `native_transport_fixtures::native_trust_tooling_fixture_flow` passed
  - Playwright passed 5 route and workflow specs

### Fix And Retest Notes

- The first `validate` pass failed in Playwright because `tests/e2e/hosts.spec.ts` and
  `tests/e2e/app-launch.spec.ts` still expected the old host heading and the old Settings runtime
  copy.
- After updating those expectations to match the current decluttered host list and `Runtime mode`
  wording, `TERMSNIP_RUN_E2E=1 npm run validate` passed cleanly.

### Environment Notes

- Local macOS localhost SSH fixtures need an unsandboxed shell in this desktop environment because
  temporary `sshd` children cannot complete preauth correctly inside the default sandbox.
- `native:key` is the fast local native key regression.
- `native:trust` is the phase gate for native trust and key tooling.
- `native:fixtures` remains the broader localhost transport regression and now runs as an explicit
  ignored test.

## 2026-03-29

### Passed

- `npx pnpm install`
- `npx pnpm lint`
- `npx pnpm --filter desktop test`
  - `apps/desktop/src/lib/connections.test.ts` passed 3 tests
  - `apps/desktop/src/store/app-store.test.ts` passed 2 tests
  - `apps/desktop/src/store/hosts-store.test.ts` passed 4 tests
  - `apps/desktop/src/store/sessions-store.test.ts` passed 6 tests
  - `apps/desktop/src/store/snippets-store.test.ts` passed 1 test
- `npx pnpm --filter desktop build`
  - PASS after host shell, session runtime, transfer workspace, restore scrub, and key inventory changes
  - Note: Vite emits a chunk-size warning for the main bundle after xterm.js and the transfer/key screens were added; build still succeeds

### Browser and Runtime Validation

- Playwright host-management smoke
  - Loaded `http://localhost:5174/hosts`
  - Confirmed rendered shell, sidebar, top tabs, and host inventory
  - Added a new host (`Analytics Worker`) through the modal flow
  - Opened command palette and navigated to `/settings`
  - Re-loaded `/hosts` and confirmed zero browser console errors

- Real SSH validation against local sshd
  - Local sshd launched with config at `/tmp/termsnip-sshd/sshd_config`
  - Direct CLI validation passed:
    - `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/tmp/termsnip-sshd/known_hosts -i /tmp/termsnip-sshd/client_key -p 2222 deffenda@127.0.0.1 'echo TERMSNIP_SSH_OK'`
    - output included `TERMSNIP_SSH_OK`
  - Backend status endpoint passed:
    - `curl -s http://127.0.0.1:8790/api/backend/status`
  - Playwright session smoke passed:
    - Opened `/sessions`
    - Restored the saved `Local SSH Test` tab in disconnected state after refresh
    - Clicked `Reconnect`
    - Verified pane status changed to `ssh · connected`
    - Confirmed browser console errors dropped to `0` after stale-session scrub and resize-race fix

- Real SFTP validation against local sshd
  - Fixture directory created at `/tmp/termsnip-sftp-fixture`
  - Direct backend validation passed:
    - `POST /api/backend/sftp/list`
    - `POST /api/backend/sftp/mkdir`
    - `POST /api/backend/sftp/rename`
    - `POST /api/backend/sftp/delete`
    - `POST /api/backend/sftp/upload`
  - Playwright transfer smoke passed:
    - Opened `/transfers`
    - Switched active host to `Local SSH Test`
    - Navigated to `/tmp/termsnip-sftp-fixture`
    - Created folder `ui-created`
    - Renamed it to `ui-renamed`
    - Uploaded `/tmp/termsnip-upload-2.txt`
    - Downloaded `README.txt`
    - Deleted `ui-renamed`
    - Confirmed queue entries completed and browser console errors were `0` on a clean page load

- Key-management validation
  - Direct backend key inspection passed:
    - `POST /api/backend/keys/inspect` on `/tmp/termsnip-sshd/client_key`
  - Direct backend key generation passed:
    - `POST /api/backend/keys/generate` on `/tmp/termsnip-generated/id_ed25519`
  - Playwright key workflow passed:
    - Opened `/keys`
    - Imported `/tmp/termsnip-sshd/client_key` as `Fixture Imported Key`
    - Generated `/tmp/termsnip-generated/ui_generated` as `UI Generated Key`
    - Assigned `UI Generated Key` to host `Billing API`
    - Navigated to `/hosts?focus=billing-api`
    - Confirmed `Billing API` shows `UI Generated Key` in both host inventory and details pane

- Local forwarding validation
  - Fixture HTTP target served `FORWARD_OK` on `127.0.0.1:18081`
  - Playwright session workflow passed:
    - Opened `/sessions`
    - Reconnected `Local SSH Test`
    - Created a local forward from `127.0.0.1:19090` to `127.0.0.1:18081`
    - Confirmed the session sidebar listed the active forward
  - Direct host validation passed:
    - `curl -s --max-time 3 http://127.0.0.1:19090`
    - output included `FORWARD_OK`
  - Teardown validation passed:
    - Clicked `Stop` in the UI
    - `curl -sS --max-time 2 http://127.0.0.1:19090`
    - exited with code `7` after forward teardown

- Remote forwarding validation
  - Playwright session workflow passed:
    - Reconnected `Local SSH Test B`
    - Switched the forward panel to `Remote forward`
    - Created a remote forward from `127.0.0.1:19091` to local destination `127.0.0.1:18081`
    - Confirmed the session sidebar listed the active remote forward
  - Direct host validation passed:
    - `curl -s --max-time 3 http://127.0.0.1:19091`
    - output included `FORWARD_OK`
  - Teardown validation passed:
    - Clicked `Stop` in the UI
    - `curl -sS --max-time 2 http://127.0.0.1:19091`
    - exited with code `7` after remote forward teardown

- Dense workspace validation
  - Re-loaded `/hosts`, `/sessions`, `/keys`, and `/transfers` in a `1440x900` viewport
  - Confirmed the shell and main screens render compact headers, reduced chrome, section shortcut badges, and a row-based host inventory
  - Verified `/hosts` kept the filter row, first inventory actions, and the details pane visible in the same viewport
  - Verified `/sessions` kept the tab strip, split controls, and session details visible in the same viewport
  - Captured fresh Playwright screenshots for the dense hosts and sessions workspaces
  - Browser console errors were `0` after the density pass

- Command palette and section-shortcut validation
  - Palette navigation passed:
    - Opened the command palette on `/sessions`
    - Queried `Local SSH Test B`
    - Pressed `Enter`
    - Confirmed routing to the matching `/sessions?tabId=...` workspace
  - Host-launch path passed:
    - Opened the command palette on `/hosts`
    - Queried `Local SSH Test`
    - Triggered `Open`
    - Confirmed routing to `/sessions?tabId=...`
  - Host action coverage passed:
    - Opened the command palette on `/transfers`
    - Triggered `Files` for `Jump Target Validation`
    - Confirmed routing to `/transfers` with `Jump Target Validation` selected and `/tmp/termsnip-sftp-fixture` loaded
    - Triggered `Trust` for `Jump Target Validation`
    - Confirmed routing to `/keys?scanHost=jump-target-validation&autoScan=1`
    - Confirmed the known-host scan auto-selected `Jump Target Validation` and returned `127.0.0.1:2223`
  - Snippet action coverage passed:
    - Seeded `Palette Jump Marker`
    - Opened the command palette on `/keys?scanHost=jump-target-validation&autoScan=1`
    - Triggered `Run`
    - Confirmed routing back to `/sessions?tabId=...`
    - `cat /tmp/termsnip-palette-snippet.log`
    - output included `PALETTE_SNIPPET_OK`
  - Section shortcut routing passed:
    - Dispatched `⌘4`, `⌘2`, and `⌘6` through the app keyboard event path
    - Confirmed routing to `/keys`, `/sessions`, and `/settings`
    - Replayed `⌘1` and `⌘2` from `/sessions`
    - Confirmed routing back to `/hosts` and then `/sessions`
  - Browser console errors were `0` after palette and shortcut routing checks

- Known-hosts validation
  - Direct backend scan passed:
    - `POST /api/backend/known-hosts/scan` for `127.0.0.1:2222`
    - response included `ssh-ed25519` and fingerprint `SHA256:tytFgcdbqg71iiYMcnxb7NuC5yl5kl3U1C9CTBhLPDc`
  - Playwright trust workflow passed:
    - Opened `/keys`
    - Selected `Local SSH Test` in the known-host scan panel
    - Clicked `Scan`
    - Clicked `Trust`
    - Navigated to `/hosts`
    - Selected `Local SSH Test`
    - Confirmed host details show `ssh-ed25519 · trusted` plus the scanned fingerprint
  - Trusted-session smoke passed:
    - Opened `/sessions`
    - Reconnected `Local SSH Test B`
    - Verified pane status changed to `ssh · connected`
  - Strict-trust enforcement passed:
    - Edited `Local SSH Test B` and changed `Host key trust` to `Require trusted key`
    - Revoked trust from the host details pane in `/hosts`
    - Opened `/sessions`
    - Confirmed the strict host dropped to `ssh · error`
    - Navigated `Sessions -> Keys` and confirmed browser console errors stayed at `0` after the xterm teardown fix
    - Re-scanned `Local SSH Test B`, clicked `Trust`, returned to `/sessions`, and clicked `Reconnect`
    - Verified pane status returned to `ssh · connected`
    - `cat /tmp/termsnip-strict-trust.log`
    - output included `STRICT_TRUST_OK`

- Session restore and lifecycle validation
  - Restore reconnect passed:
    - Opened `/sessions`
    - Reconnected `Local SSH Test B`
    - Reloaded the page
    - Verified pane status restored as `ssh · connected`
    - Sent `printf 'RESTORE_OK\n' > /tmp/termsnip-restore.log` through the restored terminal
    - `cat /tmp/termsnip-restore.log`
    - output included `RESTORE_OK`
  - Route-change teardown passed:
    - Replayed `Sessions -> Keys` in a clean browser context
    - Confirmed browser console errors stayed at `0`
  - Multi-tab and split restore passed:
    - Seeded a temporary localhost validation host using the unencrypted fixture key
    - Opened its session, added a second split pane, and reconnected both panes
    - Switched the active tab back to `Local SSH Test`
    - Reloaded `/sessions`
    - Selected the background-restored validation tab without clicking `Reconnect`
    - Confirmed the restored split tab showed `0` visible `Reconnect` actions and `2` visible `Disconnect` actions
    - Sent `printf 'MULTI_RESTORE_OK\n' > /tmp/termsnip-multi-tab-restore.log`
    - `cat /tmp/termsnip-multi-tab-restore.log`
    - output included `MULTI_RESTORE_OK`
  - Missing-secret restore queue passed:
    - Added host `Local SSH Pending Restore` for `deffenda@127.0.0.1:2222` using `/tmp/termsnip-sshd/client_key_passphrase`
    - Opened `/sessions?tabId=...`
    - Confirmed the `Open SSH session: Local SSH Pending Restore` modal requested only `Key passphrase`
    - Entered `fixture-passphrase` and connected
    - Sent `printf 'PENDING_RESTORE_PRIME_OK\n' > /tmp/termsnip-pending-restore-prime.log`
    - Reloaded `/sessions`
    - Confirmed the pane status rendered as `ssh · needs secrets` with a `Resume` action
    - Clicked `Resume`
    - Confirmed the `Resume SSH session: Local SSH Pending Restore` modal requested the same passphrase
    - Entered `fixture-passphrase` and reconnected
    - Sent `printf 'PENDING_RESTORE_RESUME_OK\n' > /tmp/termsnip-pending-restore-resume.log`
    - `cat /tmp/termsnip-pending-restore-resume.log`
    - output included `PENDING_RESTORE_RESUME_OK`

- Secret persistence validation
  - Host metadata scrub passed:
    - Reloaded the app after the hosts-store migration to version `2`
    - Read `window.localStorage.getItem('termsnip-hosts')`
    - Confirmed `hasPasswordField` was `false`
    - Confirmed `hasPassphraseField` was `false`
  - Runtime connection path passed after secret-store refactor:
    - Re-opened `/sessions`
    - Verified strict host `Local SSH Test B` restored as `ssh · connected`
    - Sent `printf 'POST_SECRET_STORE_OK\n' > /tmp/termsnip-post-secret-store.log`
    - `cat /tmp/termsnip-post-secret-store.log`
    - output included `POST_SECRET_STORE_OK`
  - Missing-secret prompt passed with a real passphrase-protected key:
    - Generated `/tmp/termsnip-sshd/client_key_passphrase` with passphrase `fixture-passphrase`
    - Added the public key to `/tmp/termsnip-sshd/authorized_keys`
    - Imported the key in `/keys` as `Fixture Passphrase Key` with `Key uses a passphrase` enabled
    - Assigned it to `Local SSH Test B`
    - Hard-loaded `/sessions`
    - Confirmed the `Open SSH session: Local SSH Test B` modal requested only `Key passphrase`
    - Entered `fixture-passphrase` and clicked `Continue`
    - Verified pane status changed to `ssh · connected`
    - Sent `printf 'PASSPHRASE_PROMPT_OK\n' > /tmp/termsnip-passphrase-prompt.log`
    - `cat /tmp/termsnip-passphrase-prompt.log`
    - output included `PASSPHRASE_PROMPT_OK`

- Snippet validation
  - Snippet store/unit coverage passed:
    - `apps/desktop/src/store/snippets-store.test.ts`
  - Active-pane execution passed against local sshd:
    - Created `Write active snippet marker`
    - Clicked `Run in active pane`
    - `cat /tmp/termsnip-snippet-active.log`
    - output included `ACTIVE_OK`
  - Multi-host broadcast passed against two localhost SSH targets:
    - Added a second local fixture host `Local SSH Test B` pointing at the same localhost sshd
    - Created `Write broadcast snippet marker`
    - Clicked `Broadcast to selected hosts`
    - UI reported `ok` for both `Local SSH Test` and `Local SSH Test B`
    - `wc -l /tmp/termsnip-snippet-broadcast.log`
    - output reported `2`

- Jump-host validation
  - Local fixture setup passed:
    - Started a second localhost `sshd` on `127.0.0.1:2223` in a persistent PTY session
    - Re-used the existing localhost host on `127.0.0.1:2222` as the bastion
    - Direct CLI validation passed:
      - `ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/tmp/termsnip-sshd-2/known_hosts -i /tmp/termsnip-sshd/client_key -p 2223 deffenda@127.0.0.1 'printf STABLE_2223_OK'`
      - output included `STABLE_2223_OK`
  - Direct backend exec passed through the bastion:
    - `POST /api/backend/snippets/execute` against `127.0.0.1:2223` with nested jump host `127.0.0.1:2222`
    - response stdout included `JUMP_EXEC_OK`
  - Direct backend SFTP passed through the bastion:
    - `POST /api/backend/sftp/list` against `127.0.0.1:2223` with nested jump host `127.0.0.1:2222`
    - response listed `/tmp/termsnip-sftp-fixture/README.txt`

- SSH agent forwarding and environment-variable validation
  - Dense host-editor UI passed:
    - Opened `http://127.0.0.1:8790/hosts?new=1`
    - Created `Local Env Agent Validation` for `deffenda@127.0.0.1:2222` using `/tmp/termsnip-sshd/client_key`
    - Saved `TERMSNIP_ENV_TEST=ENV_OK` and `TERMSNIP_ENV_MODE=shell` in `Session environment`
    - Enabled `Forward local SSH agent to this host`
    - Confirmed the host row showed `Private key · Unknown key allowed · agent`
    - Confirmed the details pane showed `SSH agent forwarded`, `Agent forwarding enabled`, and `2 env vars`
  - Direct interactive shell validation passed against local sshd:
    - `POST /api/backend/sessions` for the localhost fixture with `agentForwarding: true`
    - `WS /ws/sessions/...` sent terminal input frames that wrote:
      - `/tmp/termsnip-env-shell.log`
      - `/tmp/termsnip-env-mode-shell.log`
      - `/tmp/termsnip-agent-sock-shell.log`
      - `/tmp/termsnip-agent-shell.log`
    - `cat /tmp/termsnip-env-shell.log`
    - output included `ENV_OK`
    - `cat /tmp/termsnip-env-mode-shell.log`
    - output included `shell`
    - `cat /tmp/termsnip-agent-sock-shell.log`
    - output included a forwarded `SSH_AUTH_SOCK` path under `$HOME/.ssh/agent/`
    - `head -n 1 /tmp/termsnip-agent-shell.log`
    - output included `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG5dMY+4w9h88yfkabF/DKJ6PJw8/y/uaJnZ7LvMHnSw deffenda@fmwebide`
  - Direct exec/snippet validation passed against local sshd:
    - `POST /api/backend/snippets/execute` for the same localhost fixture with `agentForwarding: true`
    - stdout included:
      - `ENV_OK`
      - `shell`
      - the forwarded `ssh-ed25519 ... deffenda@fmwebide` public key line
    - This validation also confirmed the backend fallback that prefixes `export KEY=VALUE` for remotes that do not honor arbitrary SSH `env` requests

- Quick-connect and duplicate-session validation
  - Store/runtime checks passed:
    - `apps/desktop/src/store/sessions-store.test.ts`
    - duplicate-session helper produced a second tab titled `Production Gateway (2)`
  - Playwright session-workspace validation passed:
    - Opened `http://127.0.0.1:8790/sessions`
    - Filtered `Quick connect` to `Local Env Agent Validation`
    - Clicked the reuse action and confirmed the session summary stayed at `2 tabs active`
    - Clicked `New` and confirmed the session summary advanced to `3 tabs active`
    - Confirmed the tab strip rendered `Local Env Agent Validation (2)`
    - Clicked `Duplicate tab` in the active workspace header
    - Confirmed the session summary advanced to `4 tabs active`
    - Confirmed the tab strip rendered `Local Env Agent Validation (3)`
    - Reloaded `/sessions` in a fresh browser context and confirmed browser console errors were `0`
  - Raw interactive SSH session passed through the bastion:
    - `POST /api/backend/sessions` against `127.0.0.1:2223` with nested jump host `127.0.0.1:2222`
    - Attached `ws://127.0.0.1:8790/ws/sessions/<sessionId>`
    - wrote `printf JUMP_WS_OK`
    - websocket stream returned `JUMP_WS_OK`
  - UI host and transfer smoke passed:
    - Seeded a temporary host `Jump Target Validation` with `Jump host = Local SSH Test`
    - Confirmed the Hosts details pane showed `Jump host -> Local SSH Test`
    - Confirmed the Transfers workspace listed `README.txt` for the jump-target host
  - UI terminal session path passed:
    - Opened `/hosts?focus=jump-target-validation`
    - Clicked `Open session`
    - Verified pane status changed to `ssh · connected`
    - Sent `printf JUMP_UI_OK > /tmp/termsnip-jump-ui.log`
    - `cat /tmp/termsnip-jump-ui.log`
    - output included `JUMP_UI_OK`
  - Route-hop snippet reconnect passed:
    - Navigated to `/keys?scanHost=jump-target-validation&autoScan=1`
    - Opened the command palette while the active session tab was disconnected in the palette summary
    - Triggered `Run` for `Palette Jump Marker`
    - Verified the session tab returned to `ssh · connected`
    - `cat /tmp/termsnip-palette-snippet.log`
    - output included `PALETTE_SNIPPET_OK`

- Settings import/export validation
  - Unit coverage passed:
    - `apps/desktop/src/lib/local-config.test.ts`
  - Export path passed:
    - Opened `/settings`
    - Clicked `Export config`
    - Confirmed status banner reported `Exported 2 hosts, 0 keys, 1 snippets, and 0 trusted host entries.`
    - Playwright downloaded `termsnip-config-2026-03-29.json`
  - Import path passed:
    - Created `/tmp/termsnip-import-config.json`
    - Clicked `Import config`
    - Uploaded `/tmp/termsnip-import-config.json`
    - Confirmed status banner reported `Imported 1 hosts, 0 keys, 0 snippets, and 0 trusted host entries. Sessions were reset so the workspace can reconnect cleanly.`
    - Opened `/hosts`
    - Confirmed the inventory now shows only `Imported Fixture Host`
  - Browser console errors were `0` through the Settings validation flow

- Settings preference validation
  - Unit coverage passed:
    - `apps/desktop/src/store/app-store.test.ts`
  - Browser persistence passed:
    - Opened `/settings`
    - Clicked `Comfortable`
    - Clicked `Section shortcuts enabled`
    - Read `window.localStorage.getItem('termsnip-app')`
    - confirmed `workspaceDensity` was `comfortable`
    - confirmed `sectionShortcutsEnabled` was `false`
    - Reloaded `/settings`
    - confirmed the shell reloaded without section shortcut badges
    - read `window.localStorage.getItem('termsnip-app')` again
    - confirmed it still reported `comfortable` and `false`
    - Reset the validated browser state to `Compact` plus `Section shortcuts enabled`
    - confirmed `window.localStorage.getItem('termsnip-app')` reported `compact` and `true`

- Modal autofill and console-noise cleanup validation
  - Host editor cleanup passed:
    - Rebuilt the static app bundle
    - Opened `http://127.0.0.1:8790/hosts?new=1` in a fresh browser page
    - Confirmed the `Add Host` modal rendered with password, passphrase, and username autocomplete metadata
    - Read browser console messages after load
    - confirmed total messages were `0`

### Blocked / Not Run

- `cargo check --manifest-path src-tauri/Cargo.toml`
  - BLOCKED: `cargo` is not installed in this environment
- Playwright end-to-end test suite under `tests/e2e`
  - NOT RUN: repo test harness is still placeholder-only
