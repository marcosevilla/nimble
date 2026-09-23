//! Durable focus engine. The legacy single-task marker (`daily_state.focus_*`
//! start/end/get) was retired with its last consumer; the engine owns timing.

pub mod schema;
pub mod engine;
pub mod clock;
pub mod queue;
pub mod replica;
pub mod task_write;
