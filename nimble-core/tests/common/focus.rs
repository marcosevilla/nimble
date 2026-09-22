use nimble_core::db::focus::{clock::ManualClock, engine::FocusService};
use nimble_core::focus_types::{FocusAction, FocusCommand, FocusSnapshot};
use nimble_core::types::CreateTaskInput;
use sqlx::SqlitePool;

pub struct Harness {
    pub pool: SqlitePool,
    pub service: FocusService,
    #[allow(dead_code)] // Some focused test binaries do not drive the manual clock.
    pub clock: std::sync::Arc<ManualClock>,
}

impl Harness {
    pub async fn new() -> Self {
        let pool = nimble_core::test_util::test_pool().await;
        let clock = std::sync::Arc::new(ManualClock::default());
        let service = FocusService::with_clock(pool.clone(), "test-device".into(), clock.clone());
        service.initialize().await.unwrap();
        Self {
            pool,
            service,
            clock,
        }
    }

    pub async fn task(&self, title: &str) -> String {
        nimble_core::db::tasks::create_local_task(
            &self.pool,
            CreateTaskInput {
                content: title.into(),
                ..Default::default()
            },
        )
        .await
        .unwrap()
        .id
    }

    pub async fn send(
        &self,
        action: FocusAction,
    ) -> nimble_core::Result<nimble_core::focus_types::FocusReply> {
        let snap = self.snapshot().await;
        self.service
            .execute(FocusCommand {
                command_id: uuid::Uuid::new_v4().to_string(),
                expected_engine_revision: snap.engine_revision,
                expected_queue_revision: snap.queue_revision,
                owner_epoch: snap.owner_epoch,
                process_generation: snap.process_generation,
                session_id: snap.session.map(|s| s.id),
                action,
            })
            .await
    }

    pub async fn advance(&self, ms: u64) {
        self.service
            .checkpoint(ms, chrono::Utc::now().to_rfc3339())
            .await
            .unwrap();
    }

    pub async fn snapshot(&self) -> FocusSnapshot {
        self.service.snapshot().await.unwrap()
    }
}
