use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub use nimble_core::types::{DocFolder, DocNote, Document};

#[tauri::command]
pub async fn get_doc_folders(app: AppHandle) -> Result<Vec<DocFolder>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::docs::get_doc_folders(pool.inner()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_doc_folder(app: AppHandle, name: String) -> Result<DocFolder, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::docs::create_doc_folder(pool.inner(), &name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_doc_folder(app: AppHandle, id: String, name: String) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::docs::rename_doc_folder(pool.inner(), &id, &name).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_doc_folder(app: AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::docs::delete_doc_folder(pool.inner(), &id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_documents(app: AppHandle, folder_id: Option<String>) -> Result<Vec<Document>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::docs::get_documents(pool.inner(), folder_id.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_document(app: AppHandle, id: String) -> Result<Option<Document>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::docs::get_document(pool.inner(), &id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_document(app: AppHandle, title: String, folder_id: Option<String>) -> Result<Document, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::docs::create_document(pool.inner(), &title, folder_id.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_document(
    app: AppHandle,
    id: String,
    title: Option<String>,
    content: Option<String>,
    folder_id: Option<String>,
) -> Result<Document, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::docs::update_document(pool.inner(), &id, title.as_deref(), content.as_deref(), folder_id.as_deref()).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_document(app: AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::docs::delete_document(pool.inner(), &id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_documents(app: AppHandle, query: String) -> Result<Vec<Document>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::docs::search_documents(pool.inner(), &query).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_doc_notes(app: AppHandle, doc_id: String) -> Result<Vec<DocNote>, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::docs::get_doc_notes(pool.inner(), &doc_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_doc_note(app: AppHandle, doc_id: String, content: String) -> Result<DocNote, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::docs::create_doc_note(pool.inner(), &doc_id, &content).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_doc_note(app: AppHandle, id: String) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::docs::delete_doc_note(pool.inner(), &id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reorder_doc_notes(app: AppHandle, note_ids: Vec<String>) -> Result<(), String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::docs::reorder_doc_notes(pool.inner(), &note_ids).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preview_docs_markdown_migration(
    app: AppHandle,
) -> Result<nimble_core::db::docs::DocsMdPreview, String> {
    let pool = app.state::<SqlitePool>();
    nimble_core::db::docs::preview_docs_markdown_migration(pool.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn migrate_docs_to_markdown(
    app: AppHandle,
) -> Result<nimble_core::db::docs::DocsMdResult, String> {
    let pool = app.state::<SqlitePool>();
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let backup = app_dir.join(format!("nimble-backup-pre-markdown-{stamp}.db"));
    nimble_core::db::docs::migrate_docs_to_markdown(
        pool.inner(),
        backup.to_str().ok_or("backup path not utf-8")?,
    )
    .await
    .map_err(|e| e.to_string())
}
