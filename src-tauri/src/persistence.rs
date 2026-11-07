//! Typed persistence commands for the renderer (#472).
//!
//! The renderer used to reach SQLite through tauri-plugin-sql's `load`,
//! `select` and `execute` commands, which accept any database path and any SQL.
//! A compromised renderer could therefore open or create files anywhere
//! (`load` with an absolute path, `ATTACH DATABASE`, `VACUUM INTO`). The plugin
//! has no way to scope that, so the renderer now gets only these operations,
//! on fixed tables, with every statement written here.
//!
//! tauri-plugin-sql is still registered: it preloads the database and runs the
//! migrations at startup. This module opens its own pool on the same file
//! lazily, after that setup has finished, and the renderer is no longer granted
//! any `sql:` permission.

use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::path::Path;
use std::time::Duration;

/// Every statement for one persisted store, written out in full so no SQL is
/// ever assembled at run time.
struct StoreStatements {
    table: &'static str,
    select: &'static str,
    upsert: &'static str,
    delete: &'static str,
}

macro_rules! store_statements {
    ($table:literal) => {
        StoreStatements {
            table: $table,
            select: concat!("SELECT payload FROM ", $table, " WHERE id = $1 LIMIT 1"),
            upsert: concat!(
                "INSERT INTO ",
                $table,
                " (id, payload, updated_at) VALUES ($1, $2, datetime('now')) \
                 ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, \
                 updated_at = excluded.updated_at"
            ),
            delete: concat!("DELETE FROM ", $table, " WHERE id = $1"),
        }
    };
}

/// Persisted zustand store names and their tables. Matches the renderer's
/// store names in `apps/desktop/src/lib/persistence.ts`.
const STORES: [(&str, StoreStatements); 6] = [
    ("terminal-workspace-hosts", store_statements!("hosts_store")),
    ("terminal-workspace-keys", store_statements!("keys_store")),
    (
        "terminal-workspace-known-hosts",
        store_statements!("known_hosts_store"),
    ),
    (
        "terminal-workspace-identities",
        store_statements!("identities_store"),
    ),
    (
        "terminal-workspace-snippets",
        store_statements!("snippets_store"),
    ),
    (
        "terminal-workspace-runbooks",
        store_statements!("runbooks_store"),
    ),
];

/// The only `kind` values the `deletions` table holds.
const DELETION_KINDS: [&str; 5] = ["hosts", "keys", "snippets", "knownHosts", "identities"];

/// Each store keeps its whole payload in one row with this id.
const STATE_ROW_ID: &str = "state";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreRequest {
    pub store: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreWriteRequest {
    pub store: String,
    pub payload: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletionRecord {
    pub kind: String,
    pub id: String,
    pub deleted_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletionsReplaceRequest {
    pub records: Vec<DeletionRecord>,
}

/// Managed Tauri state: the pool the commands use.
pub struct PersistenceStore {
    pool: SqlitePool,
}

impl PersistenceStore {
    /// Lazy, so creating it during setup neither blocks nor opens the file
    /// before tauri-plugin-sql has bootstrapped and migrated it. The file must
    /// already exist: the plugin's preload creates it.
    ///
    /// A lazy sqlx pool must be created inside a Tokio context, and Tauri's
    /// setup closure runs on the main thread without one, so this enters
    /// Tauri's own runtime first. The pool's background tasks then run there.
    pub fn open_lazy(database_path: &Path) -> Self {
        let runtime = tauri::async_runtime::handle();
        let _context = runtime.inner().enter();
        let options = SqliteConnectOptions::new()
            .filename(database_path)
            .create_if_missing(false)
            .busy_timeout(Duration::from_secs(5));
        Self {
            pool: SqlitePoolOptions::new().connect_lazy_with(options),
        }
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// Close the pool, waiting for any operation already holding a connection
    /// to finish, so a write that started before quit is committed rather than
    /// cut off when the process exits. Later calls fail with `PoolClosed`.
    /// The SQL plugin does the same for its own pools on `RunEvent::Exit`;
    /// this pool is the app's, so the app closes it.
    pub fn close_blocking(&self) {
        tauri::async_runtime::block_on(self.pool.close());
    }
}

fn statements_for(store: &str) -> Result<&'static StoreStatements, String> {
    STORES
        .iter()
        .find(|(name, _)| *name == store)
        .map(|(_, statements)| statements)
        .ok_or_else(|| format!("Unknown persisted store: {store:?}"))
}

fn check_deletion_kind(kind: &str) -> Result<(), String> {
    if DELETION_KINDS.contains(&kind) {
        Ok(())
    } else {
        Err(format!("Unknown deletion kind: {kind:?}"))
    }
}

fn sql_error(action: &str) -> impl Fn(sqlx::Error) -> String + '_ {
    move |error| format!("SQLite {action} failed: {error}")
}

fn store_error<'a>(
    action: &'a str,
    statements: &'a StoreStatements,
) -> impl Fn(sqlx::Error) -> String + 'a {
    move |error| format!("SQLite {action} of {} failed: {error}", statements.table)
}

pub async fn read_store(pool: &SqlitePool, store: &str) -> Result<Option<String>, String> {
    let statements = statements_for(store)?;
    sqlx::query_scalar::<_, String>(statements.select)
        .bind(STATE_ROW_ID)
        .fetch_optional(pool)
        .await
        .map_err(store_error("read", statements))
}

pub async fn write_store(pool: &SqlitePool, store: &str, payload: &str) -> Result<(), String> {
    let statements = statements_for(store)?;
    sqlx::query(statements.upsert)
        .bind(STATE_ROW_ID)
        .bind(payload)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(store_error("write", statements))
}

pub async fn remove_store(pool: &SqlitePool, store: &str) -> Result<(), String> {
    let statements = statements_for(store)?;
    sqlx::query(statements.delete)
        .bind(STATE_ROW_ID)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(store_error("remove", statements))
}

pub async fn read_deletions(pool: &SqlitePool) -> Result<Vec<DeletionRecord>, String> {
    let rows = sqlx::query_as::<_, (String, String, String)>(
        "SELECT kind, id, deleted_at FROM deletions ORDER BY deleted_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(sql_error("read deletions"))?;
    Ok(rows
        .into_iter()
        .map(|(kind, id, deleted_at)| DeletionRecord {
            kind,
            id,
            deleted_at,
        })
        .collect())
}

/// Replace every deletion record in one transaction. Every kind is checked
/// before anything is written; a failure part-way rolls the whole replace back.
/// This is one real transaction on one connection, unlike the renderer's old
/// separate `BEGIN` and `COMMIT` calls, which a pool could send to different
/// connections.
pub async fn replace_deletions(
    pool: &SqlitePool,
    records: &[DeletionRecord],
) -> Result<(), String> {
    for record in records {
        check_deletion_kind(&record.kind)?;
    }
    let mut transaction = pool.begin().await.map_err(sql_error("begin"))?;
    sqlx::query("DELETE FROM deletions")
        .execute(&mut *transaction)
        .await
        .map_err(sql_error("clear deletions"))?;
    for record in records {
        sqlx::query(
            "INSERT INTO deletions (kind, id, deleted_at)
               VALUES ($1, $2, $3)
               ON CONFLICT(kind, id) DO UPDATE SET deleted_at = excluded.deleted_at",
        )
        .bind(&record.kind)
        .bind(&record.id)
        .bind(&record.deleted_at)
        .execute(&mut *transaction)
        .await
        .map_err(sql_error("write deletion"))?;
    }
    transaction.commit().await.map_err(sql_error("commit"))
}

pub async fn clear_deletions(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query("DELETE FROM deletions")
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(sql_error("clear deletions"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static ROOT_SEQ: AtomicUsize = AtomicUsize::new(0);

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "tw-persistence-{}-{}",
                std::process::id(),
                ROOT_SEQ.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&root).expect("temp root");
            Self(root)
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// A database built by the app's real migrations, opened the way the app
    /// opens it.
    async fn migrated_store(root: &TempRoot) -> PersistenceStore {
        let path = root.0.join("terminalworkspace.db");
        let setup = SqlitePoolOptions::new()
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true),
            )
            .await
            .expect("create database");
        for migration in crate::persistence_migrations() {
            sqlx::raw_sql(migration.sql)
                .execute(&setup)
                .await
                .expect("apply migration");
        }
        setup.close().await;
        PersistenceStore::open_lazy(&path)
    }

    fn record(kind: &str, id: &str, deleted_at: &str) -> DeletionRecord {
        DeletionRecord {
            kind: kind.to_string(),
            id: id.to_string(),
            deleted_at: deleted_at.to_string(),
        }
    }

    /// Tauri's setup closure has no Tokio context. Opening the pool from a
    /// plain thread used to panic at app startup, which every async test here
    /// missed because they already run inside one.
    #[test]
    fn opening_the_store_outside_any_async_context_does_not_panic() {
        let root = TempRoot::new();
        let path = root.0.join("terminalworkspace.db");
        let opened = std::thread::spawn(move || {
            let store = PersistenceStore::open_lazy(&path);
            drop(store);
        })
        .join();
        assert!(opened.is_ok(), "open_lazy panicked outside a Tokio context");
    }

    /// #472: quitting must not cut off a save that is already running. Close
    /// has to wait for the connection it holds, and the save must be on disk
    /// afterwards.
    #[test]
    fn closing_waits_for_an_in_flight_save_and_keeps_it() {
        let root = TempRoot::new();
        let store = std::sync::Arc::new(tauri::async_runtime::block_on(migrated_store(&root)));

        let started = std::sync::Arc::new(std::sync::Barrier::new(2));
        let writer = {
            let store = store.clone();
            let started = started.clone();
            std::thread::spawn(move || {
                tauri::async_runtime::block_on(async move {
                    let mut connection = store.pool().acquire().await.expect("connection");
                    started.wait();
                    // Hold the connection, as a slow save would.
                    std::thread::sleep(Duration::from_millis(300));
                    sqlx::query(
                        "INSERT INTO hosts_store (id, payload, updated_at) \
                         VALUES ('state', 'saved-before-quit', datetime('now'))",
                    )
                    .execute(&mut *connection)
                    .await
                    .expect("in-flight save");
                })
            })
        };

        started.wait();
        let begun = std::time::Instant::now();
        store.close_blocking();
        assert!(
            begun.elapsed() >= Duration::from_millis(200),
            "close returned before the in-flight save released its connection"
        );
        writer.join().expect("writer thread");
        assert!(store.pool().is_closed());

        let reopened = PersistenceStore::open_lazy(&root.0.join("terminalworkspace.db"));
        let saved =
            tauri::async_runtime::block_on(read_store(reopened.pool(), "terminal-workspace-hosts"))
                .expect("read after reopen");
        assert_eq!(saved.as_deref(), Some("saved-before-quit"));
    }

    #[tokio::test]
    async fn every_store_round_trips_write_read_overwrite_and_remove() {
        let root = TempRoot::new();
        let store = migrated_store(&root).await;
        for (name, _) in &STORES {
            assert_eq!(
                read_store(store.pool(), name).await.unwrap(),
                None,
                "{name}"
            );
            write_store(store.pool(), name, "{\"v\":1}").await.unwrap();
            write_store(store.pool(), name, "{\"v\":2}").await.unwrap();
            assert_eq!(
                read_store(store.pool(), name).await.unwrap().as_deref(),
                Some("{\"v\":2}"),
                "{name}"
            );
            remove_store(store.pool(), name).await.unwrap();
            assert_eq!(
                read_store(store.pool(), name).await.unwrap(),
                None,
                "{name}"
            );
        }
    }

    #[tokio::test]
    async fn an_unknown_store_name_is_refused_before_any_sql_runs() {
        let root = TempRoot::new();
        let store = migrated_store(&root).await;
        for name in [
            "terminal-workspace-hosts; DROP TABLE hosts_store",
            "hosts_store",
            "",
            "sqlite_master",
        ] {
            let error = read_store(store.pool(), name).await.unwrap_err();
            assert!(error.contains("Unknown persisted store"), "{error}");
            assert!(write_store(store.pool(), name, "x").await.is_err());
            assert!(remove_store(store.pool(), name).await.is_err());
        }
        write_store(store.pool(), "terminal-workspace-hosts", "kept")
            .await
            .unwrap();
        assert_eq!(
            read_store(store.pool(), "terminal-workspace-hosts")
                .await
                .unwrap()
                .as_deref(),
            Some("kept")
        );
    }

    #[tokio::test]
    async fn deletions_replace_read_back_newest_first_and_clear() {
        let root = TempRoot::new();
        let store = migrated_store(&root).await;
        replace_deletions(
            store.pool(),
            &[
                record("hosts", "h1", "2026-01-01T00:00:00.000Z"),
                record("knownHosts", "k1", "2026-03-01T00:00:00.000Z"),
            ],
        )
        .await
        .unwrap();
        replace_deletions(
            store.pool(),
            &[
                record("keys", "x1", "2026-02-01T00:00:00.000Z"),
                record("snippets", "s1", "2026-04-01T00:00:00.000Z"),
            ],
        )
        .await
        .unwrap();
        assert_eq!(
            read_deletions(store.pool()).await.unwrap(),
            vec![
                record("snippets", "s1", "2026-04-01T00:00:00.000Z"),
                record("keys", "x1", "2026-02-01T00:00:00.000Z"),
            ]
        );
        clear_deletions(store.pool()).await.unwrap();
        assert!(read_deletions(store.pool()).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_replace_with_an_unknown_kind_changes_nothing() {
        let root = TempRoot::new();
        let store = migrated_store(&root).await;
        let existing = vec![record("hosts", "h1", "2026-01-01T00:00:00.000Z")];
        replace_deletions(store.pool(), &existing).await.unwrap();

        let error = replace_deletions(
            store.pool(),
            &[
                record("keys", "x1", "2026-02-01T00:00:00.000Z"),
                record("tables", "x2", "2026-02-02T00:00:00.000Z"),
            ],
        )
        .await
        .unwrap_err();
        assert!(error.contains("Unknown deletion kind"), "{error}");
        assert_eq!(read_deletions(store.pool()).await.unwrap(), existing);
    }

    #[tokio::test]
    async fn a_replace_that_fails_part_way_rolls_back() {
        let root = TempRoot::new();
        let store = migrated_store(&root).await;
        let existing = vec![record("hosts", "h1", "2026-01-01T00:00:00.000Z")];
        replace_deletions(store.pool(), &existing).await.unwrap();

        // Make the second insert fail after the DELETE and the first insert ran.
        sqlx::query(
            "CREATE TRIGGER fail_second BEFORE INSERT ON deletions
               WHEN NEW.id = 'boom' BEGIN SELECT RAISE(ABORT, 'forced'); END",
        )
        .execute(store.pool())
        .await
        .unwrap();
        let error = replace_deletions(
            store.pool(),
            &[
                record("keys", "x1", "2026-02-01T00:00:00.000Z"),
                record("keys", "boom", "2026-02-02T00:00:00.000Z"),
            ],
        )
        .await
        .unwrap_err();
        assert!(error.contains("forced"), "{error}");
        assert_eq!(read_deletions(store.pool()).await.unwrap(), existing);
    }

    #[test]
    fn the_store_list_matches_every_store_table_the_migrations_create() {
        let created: Vec<String> = crate::persistence_migrations()
            .iter()
            .flat_map(|migration| {
                migration
                    .sql
                    .split("CREATE TABLE IF NOT EXISTS ")
                    .skip(1)
                    .filter_map(|rest| rest.split_whitespace().next().map(str::to_string))
                    .collect::<Vec<_>>()
            })
            .filter(|table| table.ends_with("_store"))
            .collect();
        let mut listed: Vec<String> = STORES.iter().map(|(_, s)| s.table.to_string()).collect();
        let mut created_sorted = created.clone();
        created_sorted.sort();
        listed.sort();
        assert_eq!(listed, created_sorted);
    }
}
