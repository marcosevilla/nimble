use std::collections::HashMap;
use serde::{Deserialize, Serialize};

pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FocusMode { CountUp, Timebox, Pomodoro }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FocusPhase { Idle, Work, Break, RoundReady, WorkReady }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FocusStatus { Paused, Running, Ended }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FocusSource { Today, Project { project_id: String }, Local }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FocusConfig {
    pub mode: FocusMode,
    pub budget_ms: Option<u64>,
    pub work_ms: u64,
    pub break_ms: u64,
    pub rounds: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusEntry {
    pub id: String,
    pub task_id: String,
    pub occurrence_id: String,
    pub added_at: String,
    pub source: FocusSource,
    pub explicit_still_open: bool,
    pub config: FocusConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusSession {
    pub id: String,
    pub occurrence_id: String,
    pub status: FocusStatus,
    pub phase: FocusPhase,
    pub work_ms: u64,
    pub break_ms: u64,
    pub round_work_ms: u64,
    pub round: u32,
    pub config: FocusConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusSnapshot {
    pub queue_revision: u64,
    pub engine_revision: u64,
    pub owner_epoch: String,
    pub process_generation: u64,
    pub writer_device_id: String,
    pub queue: Vec<FocusEntry>,
    pub selected_occurrence_id: Option<String>,
    pub session: Option<FocusSession>,
    pub totals: HashMap<String, u64>,
    pub as_of: String,
    pub checkpoint_at: Option<String>,
    pub recovery_reason: Option<String>,
    pub replica: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusCapabilities {
    pub queue_read: bool,
    pub queue_write: bool,
    pub history_read: bool,
    pub live_timing: bool,
    pub companion: bool,
    pub import: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FocusAction {
    Enqueue { task_ids: Vec<String>, source: FocusSource, explicit_still_open: bool },
    Reorder { entry_ids: Vec<String> },
    Promote { occurrence_id: String },
    Remove { occurrence_id: String },
    Start { occurrence_id: String },
    Complete { occurrence_id: String },
    Pause, Resume, Stop, Skip, StartBreak, EndBreak,
    Configure { occurrence_id: String, config: FocusConfig },
    ArchiveHistory { occurrence_ids: Vec<String> },
    UndoDelete { token: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusCommand {
    pub command_id: String,
    pub expected_engine_revision: u64,
    pub expected_queue_revision: u64,
    pub owner_epoch: String,
    pub process_generation: u64,
    pub session_id: Option<String>,
    pub action: FocusAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusReply {
    pub snapshot: FocusSnapshot,
    pub replayed: bool,
    pub committed_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusHistoryRow {
    pub occurrence_id: String,
    pub task_id: Option<String>,
    pub title: String,
    pub total_ms: u64,
    pub recorded_ms: u64,
    pub imported_ms: u64,
    pub completed_at: Option<String>,
    pub archived: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusHistoryPage {
    pub rows: Vec<FocusHistoryRow>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FocusErrorCode { Conflict, WrongOwner, StaleOccurrence, NotFound, Invalid, Unsupported, Storage, NeedsReview }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusError {
    pub code: FocusErrorCode,
    pub message: String,
}
