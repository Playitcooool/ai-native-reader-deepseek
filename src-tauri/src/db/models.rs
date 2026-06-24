use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Document {
    pub id: String,
    pub title: Option<String>,
    pub original_filename: String,
    pub file_path: String,
    pub file_sha256: Option<String>,
    pub page_count: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened_at: Option<String>,
    pub last_page: Option<i64>,
    pub last_zoom: Option<f64>,
    pub parse_status: Option<String>,
    pub has_native_toc: Option<bool>,
    pub document_type: String,
    pub author: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProviderSettings {
    pub id: String,
    pub provider_type: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model: String,
    pub is_default: Option<bool>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProviderSettingsInput {
    /// If set, UPDATE this existing row; otherwise INSERT.
    pub id: Option<String>,
    pub provider_type: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model: String,
    pub is_default: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TestProviderResult {
    pub ok: bool,
    pub provider_id: String,
    pub model: Option<String>,
    pub latency_ms: Option<u64>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}
