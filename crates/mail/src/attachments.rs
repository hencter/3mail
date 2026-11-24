use std::path::Path;

use lettre::message::header::{ContentDisposition, ContentType};
use lettre::message::{MultiPart, SinglePart};

#[derive(Debug, Clone)]
pub struct MailAttachment {
    pub path: String,
    pub filename: String,
    pub mime_type: String,
}

fn mime_for_path(path: &Path, filename: &str) -> String {
    let by_name = mime_guess::from_path(filename).first_raw();
    let by_path = mime_guess::from_path(path).first_raw();
    by_name
        .or(by_path)
        .unwrap_or("application/octet-stream")
        .to_string()
}

pub fn singlepart_file(att: &MailAttachment) -> Result<SinglePart, String> {
    let bytes = std::fs::read(&att.path).map_err(|e| e.to_string())?;
    let mime = att.mime_type.parse::<ContentType>().unwrap_or_else(|_| {
        ContentType::parse("application/octet-stream").expect("octet-stream")
    });
    Ok(SinglePart::builder()
        .header(ContentDisposition::attachment(att.filename.as_str()))
        .header(mime)
        .body(bytes))
}

pub fn mail_attachment_from_path(path: &str, filename: &str) -> MailAttachment {
    let p = Path::new(path);
    MailAttachment {
        path: path.to_string(),
        filename: filename.to_string(),
        mime_type: mime_for_path(p, filename),
    }
}

pub fn attach_files(
    mixed: MultiPart,
    attachments: &[MailAttachment],
) -> Result<MultiPart, String> {
    let mut out = mixed;
    for att in attachments {
        out = out.singlepart(singlepart_file(att)?);
    }
    Ok(out)
}