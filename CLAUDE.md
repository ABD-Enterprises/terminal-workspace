# Local AI Adapter (Claude)

## Repo-specific notes

### Run `cargo fmt` before validating any Rust change

`scripts/validate.sh` runs `cargo fmt --check` and compiles with `-D warnings`,
so an unformatted diff fails the gate before any test runs — and the formatting
error is what you see, not the real defect underneath it.

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
```

Observed 2026-08-23: five consecutive loop iterations on #205 failed on nothing
but an import and a tuple that rustfmt wanted split differently. Each retry cost
a full backend run. When formatting was fixed, the gate immediately surfaced the
actual defect — a bounded-channel constructor that had been added but never
wired into its call site, caught as `dead_code` under `-D warnings`.

The lesson is not "formatting matters". It is that a style failure at the front
of the gate hides the substantive failure behind it, so the cheap fix has to run
first or the expensive signal never arrives.

### Changes to the PTY readers, session loops, or `native_transport` capture loops

Run the localhost sshd fixture before pushing:

```bash
TERMSNIP_RUN_SSH_FIXTURE=1 bash scripts/validate.sh
```

It is `#[ignore]`d (it needs a real sshd and an unsandboxed shell), so the
default gate skips it — and it is the only test that exercises the real
transport. The failure mode in that code is a **hang**, not a failing assertion,
so a green unit suite is not evidence there. #193 shipped a reader change with
30 consecutive clean local runs behind it and still deadlocked the ControlMaster
PTY; this fixture reproduces that in 10 seconds, while CI took 30 minutes to
report it as a timeout that looked like infra.
