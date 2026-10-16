use rusqlite::Connection;

use crate::store::DbError;

mod embedded {
    use refinery::embed_migrations;
    embed_migrations!("migrations");
}

pub fn run(conn: &mut Connection) -> Result<(), DbError> {
    embedded::migrations::runner()
        .run(conn)
        .map_err(|e| DbError::Migration(e.to_string()))?;
    Ok(())
}
