/// Prompt templates for AI workflows.

pub fn system_message() -> &'static str {
    "You are an AI reading assistant inside a PDF reader. Answer only using the provided PDF context. \
     If the context is insufficient, say what is missing. Do not invent page numbers or claims. \
     Explain clearly and teach the user."
}

pub fn explain_selection(
    title: &str,
    page_number: i64,
    toc_path: &str,
    selected_text: &str,
    evidence: &str,
) -> (String, String) {
    let user = format!(
        "Task: Explain the selected text.\n\n\
         Document: {}\n\
         Current page: {}\n\
         Current TOC path: {}\n\n\
         Selected text:\n\
         {}\n\n\
         PDF context:\n\
         {}\n\n\
         Please provide:\n\
         1. A clear explanation.\n\
         2. Any important prerequisite concepts.\n\
         3. Why this passage matters in the local section.\n\
         4. Page references using [p.X].",
        title, page_number, toc_path, selected_text, evidence
    );
    (system_message().to_string(), user)
}

pub fn summarize_page(
    title: &str,
    page_number: i64,
    toc_path: &str,
    page_text: &str,
) -> (String, String) {
    let user = format!(
        "Task: Summarize the current PDF page.\n\n\
         Document: {}\n\
         Page: {}\n\
         Current TOC path: {}\n\n\
         Page text:\n\
         {}\n\n\
         Return:\n\
         1. Main idea.\n\
         2. Key points.\n\
         3. Terms/concepts to remember.\n\
         4. One question the reader should be able to answer.\n\
         Use [p.X] references.",
        title, page_number, toc_path, page_text
    );
    (system_message().to_string(), user)
}

pub fn summarize_range(
    title: &str,
    start_page: i64,
    end_page: i64,
    toc_path: &str,
    page_texts: &str,
) -> (String, String) {
    let user = format!(
        "Task: Summarize the selected page range.\n\n\
         Document: {}\n\
         Pages: {}–{}\n\
         Current TOC path if applicable: {}\n\n\
         Page texts:\n\
         {}\n\n\
         Return:\n\
         1. Short overview.\n\
         2. Detailed bullet summary.\n\
         3. Key concepts.\n\
         4. Potential confusions.\n\
         5. 3 review questions.\n\
         Use page references like [p.X].",
        title, start_page, end_page, toc_path, page_texts
    );
    (system_message().to_string(), user)
}

pub fn ask_current_section(
    title: &str,
    current_page: i64,
    toc_title: &str,
    start_page: i64,
    end_page: i64,
    question: &str,
    evidence: &str,
) -> (String, String) {
    let user = format!(
        "Task: Answer the user's question using the current PDF section context.\n\n\
         Document: {}\n\
         Current page: {}\n\
         Current section: {}\n\
         Section page range: {}–{}\n\n\
         Question:\n\
         {}\n\n\
         Evidence:\n\
         {}\n\n\
         Rules:\n\
         - Use only the provided evidence.\n\
         - If evidence is insufficient, say so.\n\
         - Cite pages using [p.X].\n\
         - Keep the answer practical and explanatory.",
        title, current_page, toc_title, start_page, end_page, question, evidence
    );
    (system_message().to_string(), user)
}

/// Prompt for translating selected text to Chinese.
pub fn translate(selected_text: &str) -> (String, String) {
    let system = "You are a translator. Translate the given text to Chinese. \
                  Preserve original formatting. Return only the translation, no explanations.";
    let user = format!("Translate to Chinese:\n\n{}", selected_text);
    (system.to_string(), user)
}
