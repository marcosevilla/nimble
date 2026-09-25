//! One local-apply boundary for incoming task writes (Todoist pull, Turso
//! pull, conditional Google Calendar edits).
//!
//! Callers finish ALL network I/O first, then open a `TaskWrite`, apply rows
//! through `conn()` with transaction-aware SQL, and `commit` the exact
//! `TaskEffects`. With the desktop's live `FocusService`, the write runs under
//! its guard so a running session is settled with the service clock. Without
//! one (tests, `dt` with the app closed, restored profiles) it is a plain
//! IMMEDIATE transaction reconciled headlessly at the durable checkpoint.
//! Never hold a `TaskWrite` across an await on the network.
use sqlx::{SqliteConnection, SqlitePool};

use super::engine::{reconcile_remote_task_effects_tx, FocusService, FocusTaskWriteGuard};
use crate::db::task_tx::TaskEffects;

pub enum TaskWrite<'a> {
    Owned(FocusTaskWriteGuard<'a>),
    Headless(sqlx::Transaction<'static, sqlx::Sqlite>),
}

impl<'a> TaskWrite<'a> {
    pub async fn begin(pool: &SqlitePool, focus: Option<&'a FocusService>) -> crate::Result<Self> {
        let mut write = match focus {
            Some(service) => Self::Owned(service.begin_task_write().await?),
            None => Self::Headless(pool.begin_with("BEGIN IMMEDIATE").await?),
        };
        // Everything the caller applies sits after this savepoint, so a
        // failed apply can be undone without discarding the clock settle.
        sqlx::query("SAVEPOINT nimble_task_write")
            .execute(write.conn())
            .await?;
        Ok(write)
    }

    pub fn conn(&mut self) -> &mut SqliteConnection {
        match self {
            Self::Owned(guard) => guard.connection(),
            Self::Headless(tx) => tx,
        }
    }

    /// Undo every row the caller applied, then commit only the focus clock
    /// settle. Use on an apply error: dropping the write instead would freeze
    /// the live clock and pause work at the last durable checkpoint.
    pub async fn abandon(mut self) -> crate::Result<()> {
        sqlx::query("ROLLBACK TO nimble_task_write")
            .execute(self.conn())
            .await?;
        self.commit(&TaskEffects::default()).await
    }

    /// Reconcile queue/ledger effects and commit in the same transaction.
    /// The device-local search index mirrors the applied rows first
    /// (best-effort; it never fails the apply).
    pub async fn commit(mut self, effects: &TaskEffects) -> crate::Result<()> {
        crate::db::task_search::apply_effects_conn(self.conn(), effects).await;
        match self {
            Self::Owned(guard) => {
                guard.commit(effects).await?;
            }
            Self::Headless(mut tx) => {
                reconcile_remote_task_effects_tx(&mut tx, effects).await?;
                tx.commit().await?;
            }
        }
        Ok(())
    }
}
