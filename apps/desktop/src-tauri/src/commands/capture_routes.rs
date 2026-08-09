use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub use nimble_core::types::{CaptureRoute, RouteCaptureResult};

/// List all capture routes
#[tauri::command]
pub async fn get_capture_routes(app: AppHandle) -> Result<Vec<CaptureRoute>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::capture_routes::get_capture_routes(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

/// Create a new capture route
#[tauri::command]
pub async fn create_capture_route(
    app: AppHandle,
    prefix: String,
    target_type: String,
    doc_id: Option<String>,
    label: String,
    color: String,
    icon: String,
) -> Result<CaptureRoute, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::capture_routes::create_capture_route(
        pool.inner(),
        &prefix,
        &target_type,
        doc_id.as_deref(),
        &label,
        &color,
        &icon,
    )
    .await
    .map_err(|e| e.to_string())
}

/// Update an existing capture route
#[tauri::command]
pub async fn update_capture_route(
    app: AppHandle,
    id: String,
    prefix: Option<String>,
    target_type: Option<String>,
    doc_id: Option<String>,
    label: Option<String>,
    color: Option<String>,
    icon: Option<String>,
) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::capture_routes::update_capture_route(
        pool.inner(),
        &id,
        prefix.as_deref(),
        target_type.as_deref(),
        doc_id.as_deref(),
        label.as_deref(),
        color.as_deref(),
        icon.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())
}

/// Delete a capture route
#[tauri::command]
pub async fn delete_capture_route(app: AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::capture_routes::delete_capture_route(pool.inner(), &id)
        .await
        .map_err(|e| e.to_string())
}

/// Route a capture: detect prefix, create doc note or task, save to captures history
#[tauri::command]
pub async fn route_capture(
    app: AppHandle,
    prefix: String,
    content: String,
) -> Result<RouteCaptureResult, String> {
    let pool = app.state::<SqlitePool>();

    // Look up the route
    let route = nimble_core::db::capture_routes::get_route_by_prefix(pool.inner(), &prefix)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("No route found for prefix '{}'", prefix))?;

    let created_id = if route.target_type == "task" {
        // Create a task in inbox
        let task = super::local_tasks::create_local_task(
            app.clone(),
            content.clone(),
            None,
            None,
            None,
            None,
            None,
        )
        .await?;
        task.id
    } else {
        // Doc route
        let doc_id = if let Some(ref did) = route.doc_id {
            did.clone()
        } else {
            // Auto-create the doc with the route label as title
            let doc = super::docs::create_document(app.clone(), route.label.clone(), None).await?;
            // Update the route to link to this doc
            nimble_core::db::capture_routes::link_route_to_doc(pool.inner(), &route.id, &doc.id)
                .await
                .map_err(|e| e.to_string())?;
            doc.id
        };

        // Create a doc note
        let note = super::docs::create_doc_note(app.clone(), doc_id, content.clone()).await?;
        note.id
    };

    // Save to captures table for history
    let capture_id = nimble_core::db::captures::save_routed_capture(pool.inner(), &content, &route.label)
        .await
        .map_err(|e| e.to_string())?;

    // Log activity
    nimble_core::db::activity::log_activity(
        pool.inner(),
        "capture_routed",
        Some(&capture_id),
        Some(serde_json::json!({
            "prefix": &route.prefix,
            "label": &route.label,
            "target_type": &route.target_type,
            "content": &content,
        })),
    )
    .await;

    let label = route.label.clone();
    Ok(RouteCaptureResult {
        routed_to: label.clone(),
        target_type: route.target_type,
        created_id,
        label,
    })
}
