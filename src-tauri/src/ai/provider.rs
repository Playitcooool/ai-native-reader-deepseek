use serde::{Deserialize, Serialize};
use std::time::Instant;
use tokio_stream::StreamExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ChatResponse {
    pub choices: Vec<Choice>,
    #[allow(dead_code)]
    usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
pub struct Choice {
    pub message: ChatMessage,
    #[allow(dead_code)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct Usage {
    #[allow(dead_code)]
    prompt_tokens: Option<u32>,
    #[allow(dead_code)]
    completion_tokens: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TestResult {
    pub ok: bool,
    pub model: Option<String>,
    pub latency_ms: u64,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

/// Call the OpenAI-compatible /chat/completions endpoint.
pub async fn chat_completion(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: Vec<ChatMessage>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
) -> Result<ChatResponse, String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let body = ChatRequest {
        model: model.to_string(),
        messages,
        temperature,
        max_tokens,
        stream: None,
    };

    let client = reqwest::Client::new();

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "timeout".to_string()
            } else if e.is_connect() {
                "network_error".to_string()
            } else {
                format!("unknown: {}", e)
            }
        })?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let error_body = response.text().await.unwrap_or_default();
        return Err(format!("provider_error: HTTP {} - {}", status, error_body));
    }

    let chat_resp: ChatResponse = response.json().await.map_err(|e| format!("parse_error: {}", e))?;

    Ok(chat_resp)
}

// --- Streaming ---

#[derive(Debug, Deserialize)]
struct SseChunk {
    choices: Vec<SseChoice>,
}

#[derive(Debug, Deserialize)]
struct SseChoice {
    delta: SseDelta,
    #[allow(dead_code)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SseDelta {
    #[allow(dead_code)]
    role: Option<String>,
    content: Option<String>,
}

/// Call the OpenAI-compatible /chat/completions endpoint with streaming.
/// Calls `on_token` with each content token as it arrives.
/// Returns the accumulated full text on success.
pub async fn chat_completion_stream(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: Vec<ChatMessage>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    on_token: impl Fn(&str),
) -> Result<String, String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let body = ChatRequest {
        model: model.to_string(),
        messages,
        temperature,
        max_tokens,
        stream: Some(true),
    };

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream")
        .json(&body)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "timeout".to_string()
            } else if e.is_connect() {
                "network_error".to_string()
            } else {
                format!("unknown: {}", e)
            }
        })?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let error_body = response.text().await.unwrap_or_default();
        return Err(format!("provider_error: HTTP {} - {}", status, error_body));
    }

    let mut stream = response.bytes_stream();
    let mut buf = String::new();
    let mut full_text = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("stream_error: {}", e))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        // Process complete SSE events from buffer
        loop {
            // Events are separated by \n\n or \r\n\r\n
            let delim = if let Some(pos) = buf.find("\n\n") {
                pos
            } else if let Some(pos) = buf.find("\r\n\r\n") {
                pos
            } else {
                break;
            };

            let event = buf[..delim].to_string();
            buf = buf[delim + 2..].to_string(); // skip past delimiter

            if let Some(data) = event.strip_prefix("data: ") {
                let data = data.trim();
                if data == "[DONE]" {
                    return Ok(full_text);
                }
                if let Ok(chunk) = serde_json::from_str::<SseChunk>(data) {
                    if let Some(content) = chunk.choices.first().and_then(|c| c.delta.content.as_deref()) {
                        if !content.is_empty() {
                            on_token(content);
                            full_text.push_str(content);
                        }
                    }
                }
            }
        }
    }

    Ok(full_text)
}

/// Test an AI provider endpoint.
pub async fn test_provider(
    base_url: &str,
    api_key: &str,
    model: &str,
) -> TestResult {
    let start = Instant::now();

    let messages = vec![
        ChatMessage {
            role: "system".into(),
            content: "Respond with one word: ok".into(),
        },
        ChatMessage {
            role: "user".into(),
            content: "Say ok".into(),
        },
    ];

    match chat_completion(base_url, api_key, model, messages, Some(0.0), Some(10)).await {
        Ok(resp) => {
            let model_name = resp.choices.first().map(|c| c.message.content.clone());
            TestResult {
                ok: true,
                model: model_name,
                latency_ms: start.elapsed().as_millis() as u64,
                error_code: None,
                error_message: None,
            }
        }
        Err(e) => {
            let parts: Vec<&str> = e.splitn(2, ": ").collect();
            TestResult {
                ok: false,
                model: None,
                latency_ms: start.elapsed().as_millis() as u64,
                error_code: Some(parts[0].to_string()),
                error_message: parts.get(1).map(|s| s.to_string()),
            }
        }
    }
}
