use serde::Deserialize;

use crate::types::Priority;

#[derive(Debug, Deserialize)]
struct ClaudeResponse {
    content: Vec<ClaudeContent>,
}

#[derive(Debug, Deserialize)]
struct ClaudeContent {
    text: Option<String>,
}

/// Strip markdown code fences from Claude response text
fn clean_json_response(text: &str) -> &str {
    text.trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
}

/// Break a task into digestible subtasks using Claude
pub async fn break_down_task(
    api_key: &str,
    task_content: &str,
    task_description: Option<&str>,
) -> crate::Result<Vec<String>> {
    let context = if let Some(desc) = task_description {
        format!("Task: {}\nDescription: {}", task_content, desc)
    } else {
        format!("Task: {}", task_content)
    };

    let prompt = format!(
        r#"Break this task into 3-7 small, actionable subtasks. Each subtask should be a single concrete action that can be completed in one sitting. Keep them short (under 10 words each).

{}

Return ONLY a JSON array of strings. No other text. Example: ["Step one", "Step two", "Step three"]"#,
        context
    );

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 300,
            "messages": [{
                "role": "user",
                "content": prompt
            }]
        }))
        .send()
        .await
        .map_err(|e| crate::Error::Api(format!("Claude API request failed: {}", e)))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(crate::Error::Api(format!("Claude API returned {}: {}", status, body)));
    }

    let claude_resp: ClaudeResponse = resp
        .json()
        .await
        .map_err(|e| crate::Error::Api(format!("Failed to parse Claude response: {}", e)))?;

    let text = claude_resp
        .content
        .first()
        .and_then(|c| c.text.clone())
        .ok_or_else(|| crate::Error::Api("Empty response from Claude".to_string()))?;

    let clean = clean_json_response(&text);

    let subtasks: Vec<String> =
        serde_json::from_str(clean).map_err(|e| crate::Error::Parse(format!("Failed to parse subtasks: {}. Raw: {}", e, clean)))?;

    Ok(subtasks)
}

/// Generate top 3 priorities using Claude API
pub async fn generate_priorities(
    api_key: &str,
    energy_level: &str,
    calendar_summary: &str,
    tasks_summary: &str,
    obsidian_summary: &str,
) -> crate::Result<Vec<Priority>> {
    let prompt = format!(
        r#"You are a personal daily coach for someone with ADHD. Based on today's data, pick the TOP 3 priorities they should focus on. Be warm but direct.

Energy level: {energy_level}
- High energy → recommend creative or hard thinking work
- Medium energy → recommend meetings, reviews, collaborative work
- Low energy → recommend mechanical tasks, admin, easy wins

TODAY'S CALENDAR:
{calendar_summary}

TODAY'S TASKS (from Todoist):
{tasks_summary}

TODAY'S OBSIDIAN (personal tasks & habits):
{obsidian_summary}

Return EXACTLY 3 priorities as a JSON array. Each item must have:
- "title": the specific action (keep it short, under 10 words)
- "source": where it came from ("Calendar", "Todoist", "Obsidian", or "General")
- "reasoning": one sentence explaining why this is a priority right now (be specific, not generic)

Respond with ONLY the JSON array, no other text."#
    );

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 500,
            "messages": [{
                "role": "user",
                "content": prompt
            }]
        }))
        .send()
        .await
        .map_err(|e| crate::Error::Api(format!("Claude API request failed: {}", e)))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(crate::Error::Api(format!("Claude API returned {}: {}", status, body)));
    }

    let claude_resp: ClaudeResponse = resp
        .json()
        .await
        .map_err(|e| crate::Error::Api(format!("Failed to parse Claude response: {}", e)))?;

    let text = claude_resp
        .content
        .first()
        .and_then(|c| c.text.clone())
        .ok_or_else(|| crate::Error::Api("Empty response from Claude".to_string()))?;

    let clean = clean_json_response(&text);

    let priorities: Vec<Priority> =
        serde_json::from_str(clean).map_err(|e| crate::Error::Parse(format!("Failed to parse priorities JSON: {}. Raw: {}", e, clean)))?;

    Ok(priorities)
}
