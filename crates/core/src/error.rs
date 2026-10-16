use serde::Serialize;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Message(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("auth failed: {0}")]
    Auth(String),

    #[error("database: {0}")]
    Database(String),

    #[error("mail protocol: {0}")]
    Mail(String),

    #[error("keyring: {0}")]
    Keyring(String),
}

impl Error {
    pub fn msg(s: impl Into<String>) -> Self {
        Self::Message(s.into())
    }
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
