use chrono::{DateTime, Utc};
use nimble_core::{db::{reminders, tasks}, reminders::{candidate, decide, DeliveryDecision}, types::{CreateTaskInput, UpdateTaskInput}};

fn at(value:&str)->DateTime<Utc> { value.parse().unwrap() }

#[test]
fn decision_boundaries() {
    let due=at("2026-09-22T16:00:00Z");
    assert_eq!(decide(at("2026-09-22T15:59:59Z"),due),DeliveryDecision::Future);
    assert_eq!(decide(at("2026-09-22T16:01:30Z"),due),DeliveryDecision::Notify);
    assert_eq!(decide(at("2026-09-22T16:01:31Z"),due),DeliveryDecision::CatchUp);
}

#[tokio::test]
async fn restart_claim_and_reschedule_are_durable() {
    let (pool,path)=nimble_core::test_util::file_pool().await;
    let task=tasks::create_local_task(&pool,CreateTaskInput { content:"Pay bill".into(), due_date:Some("2026-09-22".into()), due_time:Some("09:00".into()), reminder_offset_minutes:Some(30), ..Default::default() }).await.unwrap();
    let key=candidate(&task,"America/Los_Angeles").unwrap().unwrap().occurrence_key;
    let due=reminders::collect_due(&pool,at("2026-09-22T17:00:00Z"),"America/Los_Angeles").await.unwrap();
    assert_eq!(due.len(),1);
    assert!(reminders::claim_notification(&pool,&key).await.unwrap());
    assert!(!reminders::claim_notification(&pool,&key).await.unwrap());
    pool.close().await;
    let url=format!("sqlite://{}",path.display());
    let pool=sqlx::SqlitePool::connect(&url).await.unwrap();
    reminders::collect_due(&pool,at("2026-09-22T17:00:00Z"),"America/Los_Angeles").await.unwrap();
    assert_eq!(reminders::list_catch_up(&pool).await.unwrap().len(),1);
    tasks::update_local_task(&pool,&task.id,UpdateTaskInput { due_time:Some("10:00".into()), ..Default::default() }).await.unwrap();
    reminders::collect_due(&pool,at("2026-09-22T17:00:00Z"),"America/Los_Angeles").await.unwrap();
    assert!(reminders::list_catch_up(&pool).await.unwrap().is_empty());
    pool.close().await;
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn title_edit_keeps_occurrence_key_and_dst_gap_needs_attention() {
    let pool=nimble_core::test_util::test_pool().await;
    let task=tasks::create_local_task(&pool,CreateTaskInput { content:"A".into(), due_date:Some("2026-03-08".into()), due_time:Some("01:30".into()), reminder_offset_minutes:Some(0), ..Default::default() }).await.unwrap();
    let key=candidate(&task,"America/Los_Angeles").unwrap().unwrap().occurrence_key;
    let renamed=tasks::update_local_task(&pool,&task.id,UpdateTaskInput { content:Some("B".into()), ..Default::default() }).await.unwrap();
    assert_eq!(candidate(&renamed,"America/Los_Angeles").unwrap().unwrap().occurrence_key,key);
    let gap=tasks::update_local_task(&pool,&task.id,UpdateTaskInput { due_time:Some("02:30".into()), ..Default::default() }).await.unwrap();
    assert!(candidate(&gap,"America/Los_Angeles").is_err());
    reminders::collect_due(&pool,at("2026-03-08T11:00:00Z"),"America/Los_Angeles").await.unwrap();
    let items=reminders::list_catch_up(&pool).await.unwrap();
    assert_eq!(items.len(),1);
    assert_eq!(items[0].task_id,task.id);
    assert_eq!(items[0].error_code.as_deref(),Some("schedule_needs_attention"));
}
