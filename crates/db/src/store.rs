use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;
use thiserror::Error;

use crate::migrations;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("migration: {0}")]
    Migration(String),
    #[error("lock poisoned")]
    Poisoned,
    #[error("{0}")]
    Other(String),
}

impl From<DbError> for three_mail_core::Error {
    fn from(value: DbError) -> Self {
        three_mail_core::Error::Database(value.to_string())
    }
}

/// Process-wide SQLite handle. Writers go through Sync Actor; readers may share.
pub struct Db {
    conn: Mutex<Connection>,
    path: PathBuf,
}

impl Db {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, DbError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| DbError::Other(format!("create db dir: {e}")))?;
        }
        let mut conn = Connection::open(&path)?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 5000;",
        )?;
        migrations::run(&mut conn)?;
        let fixed = crate::queries::normalize_stored_dates(&conn)?;
        if fixed > 0 {
            tracing::info!(fixed, "normalized stored message dates to RFC 3339");
        }
        let indexed = crate::queries::segment_search_index(&conn)?;
        if indexed > 0 {
            tracing::info!(indexed, "rebuilt search index for CJK and Cc");
        }
        Ok(Self {
            conn: Mutex::new(conn),
            path,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn conn(&self) -> Result<MutexGuard<'_, Connection>, DbError> {
        self.conn.lock().map_err(|_| DbError::Poisoned)
    }
}
