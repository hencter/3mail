use std::path::{Path, PathBuf};

use three_mail_core::{Error, Result, SendAttachment, StagedSendAttachment};

pub fn stage_attachments(
    data_dir: &Path,
    outbox_id: i64,
    sources: &[SendAttachment],
) -> Result<Vec<StagedSendAttachment>> {
    if sources.is_empty() {
        return Ok(Vec::new());
    }
    let dir = staging_dir(data_dir, outbox_id);
    std::fs::create_dir_all(&dir).map_err(|e| Error::msg(e.to_string()))?;
    let mut out = Vec::with_capacity(sources.len());
    for (i, src) in sources.iter().enumerate() {
        let src_path = Path::new(&src.path);
        if !src_path.is_file() {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(Error::msg(format!(
                "attachment not found: {}",
                src.path
            )));
        }
        let filename = src
            .filename
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .or_else(|| {
                src_path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
            })
            .unwrap_or_else(|| format!("attachment-{i}"));
        let dest = unique_dest(&dir, &filename);
        std::fs::copy(src_path, &dest).map_err(|e| Error::msg(e.to_string()))?;
        let mime_type = mime_guess::from_path(&dest)
            .first_raw()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "application/octet-stream".to_string());
        out.push(StagedSendAttachment {
            path: dest.to_string_lossy().into_owned(),
            filename: dest
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or(filename),
            mime_type,
        });
    }
    Ok(out)
}

fn staging_dir(data_dir: &Path, outbox_id: i64) -> PathBuf {
    data_dir
        .join("outbox_attachments")
        .join(outbox_id.to_string())
}

fn unique_dest(dir: &Path, filename: &str) -> PathBuf {
    let base = Path::new(filename);
    let stem = base
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "attachment".into());
    let ext = base.extension().map(|e| format!(".{}", e.to_string_lossy()));
    let mut candidate = dir.join(filename);
    let mut n = 1u32;
    while candidate.exists() {
        let name = match &ext {
            Some(ext) => format!("{stem}-{n}{ext}"),
            None => format!("{stem}-{n}"),
        };
        candidate = dir.join(name);
        n += 1;
    }
    candidate
}

pub fn remove_staging(data_dir: &Path, outbox_id: i64) {
    let dir = staging_dir(data_dir, outbox_id);
    let _ = std::fs::remove_dir_all(dir);
}