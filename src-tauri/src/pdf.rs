/// Extract title and author from a PDF file's document info dictionary.
/// Returns (title, author) where each is None if not found.
pub fn extract_metadata(file_path: &str) -> (Option<String>, Option<String>) {
    let doc = match lopdf::Document::load(file_path) {
        Ok(d) => d,
        Err(_) => return (None, None),
    };

    // Resolve the Info dict — try as a reference first, then inline
    let info: Option<&lopdf::Dictionary> = doc
        .trailer
        .get(b"Info")
        .ok()
        .and_then(|v| v.as_reference().ok())
        .and_then(|(id, gen)| doc.get_object((id, gen)).ok())
        .and_then(|o| o.as_dict().ok())
        .or_else(|| doc.trailer.get(b"Info").ok()?.as_dict().ok());

    let dict = match info {
        Some(d) => d,
        None => return (None, None),
    };

    let title = dict
        .get(b"Title")
        .ok()
        .and_then(|v| v.as_str().ok())
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .filter(|s| !s.is_empty());

    let author = dict
        .get(b"Author")
        .ok()
        .and_then(|v| v.as_str().ok())
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .filter(|s| !s.is_empty());

    (title, author)
}
