use epub::doc::EpubDoc;
use std::path::Path;

/// Extract cover image bytes from EPUB.
pub fn extract_cover(path: &str) -> Option<(Vec<u8>, String)> {
    let mut doc = EpubDoc::new(Path::new(path)).ok()?;
    doc.get_cover()
}
