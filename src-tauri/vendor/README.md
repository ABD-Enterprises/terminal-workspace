# Temporary SQLx SQLite dependency backports

The app uses SQLx 0.9.0 and `tauri-plugin-sql` 2.6.0 still uses SQLx 0.8.6.
Both drivers must link the same native SQLite library. Their released manifests
exclude `libsqlite3-sys` 0.39, whose bundled SQLite fixes
[RUSTSEC-2026-0459](https://rustsec.org/advisories/RUSTSEC-2026-0459).

These directories contain the original crates.io `sqlx-sqlite` 0.8.6 and 0.9.0
source and license files. The only runtime/build change in each copy is the
`[dependencies.libsqlite3-sys]` requirement in `Cargo.toml`, set to `0.39.1`.
Cargo-generated cache markers, the original workspace manifest and the nested
lockfile are omitted. The application lockfile records the resolved dependency.
Three documentation-comment lines in each driver have trailing whitespace removed;
no executable SQLx Rust source is changed.

Upstream has already widened the 0.9 driver's upper bound to allow 0.39 in
[this change](https://github.com/launchbadge/sqlx/commit/10462fa4414c6c7f1ed1d39bb31678e3b726878c).
The 0.8 driver needs the same dependency backport while the Tauri plugin uses it.

Provenance: the downloaded registry archives retain these upstream revisions:

- 0.8.6: `bab1b022bd56a64f9a08b46b36b97c5cff19d77e`
- 0.9.0: `003b698e99e024f3621b8043a2426fde5b741171`

Before changing either directory, compare it with the corresponding crates.io
archive. Keep the license files. Verify the native tests and Rust advisory scan;
do not add an advisory exception for the old SQLite. Remove each patch and copy
when its corresponding upstream dependency supports the fixed library, then
update the lockfile and rerun those checks.
