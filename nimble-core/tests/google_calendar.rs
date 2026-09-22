use nimble_core::integrations::google_calendar::{merge,CalendarProjection,MergeDecision,event_id};
fn projection()->CalendarProjection { CalendarProjection { task_id:"f41f0ec4-9402-4631-a84d-125a793df248".into(),content:"Task".into(),description:"Notes".into(),start_rfc3339:"2026-09-22T16:00:00+00:00".into(),end_rfc3339:"2026-09-22T16:30:00+00:00".into(),timezone:"America/Los_Angeles".into(),reminder_offset_minutes:30 } }
#[test]
fn merge_local_remote_and_disjoint_edits() {
    let base=projection();
    let mut local=base.clone(); local.content="Local".into();
    assert!(matches!(merge(&base,&local,&base),MergeDecision::Push(_)));
    let mut remote=base.clone(); remote.description="Remote".into();
    assert!(matches!(merge(&base,&base,&remote),MergeDecision::Pull(_)));
    assert!(matches!(merge(&base,&base,&base),MergeDecision::Unchanged));
    assert!(matches!(merge(&base,&local,&remote),MergeDecision::Merged(_)));
    remote.content="Remote title".into();
    assert!(matches!(merge(&base,&local,&remote),MergeDecision::Conflict));
}
#[test]
fn deterministic_event_id_and_private_marker() {
    let p=projection();
    let id=event_id(&p.task_id);
    assert!(id.chars().all(|c|c.is_ascii_lowercase()||c.is_ascii_digit()));
    let body=nimble_core::api::google_calendar::event_body(&id,&p);
    assert_eq!(body["extendedProperties"]["private"]["nimbleTaskId"],p.task_id);
    assert!(body.get("attendees").is_none());
    assert_eq!(body["reminders"]["useDefault"],false);
    assert_eq!(body["reminders"]["overrides"].as_array().unwrap().len(),1);
}

#[tokio::test]
async fn remote_timezone_change_does_not_shift_global_wall_time() {
    use nimble_core::{db::tasks,types::CreateTaskInput};
    let pool=nimble_core::test_util::test_pool().await;
    let task=tasks::create_local_task(&pool,CreateTaskInput { content:"Timed".into(),due_date:Some("2026-09-22".into()),due_time:Some("09:00".into()),reminder_offset_minutes:Some(30),google_calendar_enabled:Some(true),..Default::default() }).await.unwrap();
    let expected=nimble_core::integrations::google_calendar::project(&task,"America/Los_Angeles").unwrap().unwrap();
    let mut remote=expected.clone();
    remote.timezone="America/New_York".into();
    assert!(!nimble_core::integrations::google_calendar::apply_remote_if_unchanged(&pool,&expected,&remote).await.unwrap());
    let after=tasks::get_local_tasks(&pool,None,None,false).await.unwrap().into_iter().find(|t|t.id==task.id).unwrap();
    assert_eq!(after.due_time.as_deref(),Some("09:00"));
}

#[tokio::test]
async fn retry_after_restart_uses_same_event_id_and_owned_calendar() {
    use nimble_core::{db::{google_calendar as db,tasks},types::CreateTaskInput};
    use nimble_core::api::google_calendar::{CalendarApi,CalendarApiError};
    use serde_json::Value;
    use std::sync::Mutex;
    struct Fake { calls:Mutex<Vec<String>>, event:Value, id:String }
    impl CalendarApi for Fake {
        async fn list_page(&self,c:&str,s:Option<&str>,_:Option<&str>)->Result<(Vec<Value>,Option<String>,Option<String>),CalendarApiError>{
            assert_eq!(c,"owned-calendar"); self.calls.lock().unwrap().push(format!("list:{c}"));
            Ok((vec![],None,Some(if s.is_some(){"token-2"}else{"token-1"}.into())))
        }
        async fn get_raw(&self,c:&str,e:&str)->Result<Value,CalendarApiError>{
            assert_eq!(c,"owned-calendar"); assert_eq!(e,self.id); self.calls.lock().unwrap().push(format!("get:{c}:{e}"));
            if self.calls.lock().unwrap().iter().any(|v|v.starts_with("insert:")){Ok(self.event.clone())}else{Err(CalendarApiError::NotFound)}
        }
        async fn get(&self,_:&str,_:&str)->Result<nimble_core::integrations::google_calendar::RemoteEvent,CalendarApiError>{panic!("unexpected get")}
        async fn insert(&self,c:&str,e:&str,_:&CalendarProjection)->Result<nimble_core::integrations::google_calendar::RemoteEvent,CalendarApiError>{
            assert_eq!(c,"owned-calendar"); assert_eq!(e,self.id); self.calls.lock().unwrap().push(format!("insert:{c}:{e}"));
            nimble_core::api::google_calendar::parse_event(&self.event)
        }
        async fn update(&self,_:&str,_:&str,_:&CalendarProjection,_:&str,_:&Value)->Result<nimble_core::integrations::google_calendar::RemoteEvent,CalendarApiError>{panic!("unexpected update")}
        async fn delete(&self,_:&str,_:&str,_:Option<&str>)->Result<(),CalendarApiError>{panic!("unexpected delete")}
    }
    let pool=nimble_core::test_util::test_pool().await;
    db::set_calendar(&pool,"owned-calendar","America/Los_Angeles").await.unwrap();
    let task=tasks::create_local_task(&pool,CreateTaskInput { content:"Phone reminder".into(),due_date:Some("2026-09-22".into()),due_time:Some("09:00".into()),reminder_offset_minutes:Some(30),google_calendar_enabled:Some(true),..Default::default() }).await.unwrap();
    let p=nimble_core::integrations::google_calendar::project(&task,"America/Los_Angeles").unwrap().unwrap();
    let event_id=event_id(&task.id);
    let mut event=nimble_core::api::google_calendar::event_body(&event_id,&p);
    event["etag"]="etag-1".into();
    let event_json=event.to_string();
    let transport=Fake { calls:Mutex::new(vec![]),event:serde_json::from_str(&event_json).unwrap(),id:event_id.clone() };
    nimble_core::integrations::google_calendar::run_once(&pool,&transport,"2026-09-22T00:00:00Z".parse().unwrap()).await.unwrap();
    nimble_core::integrations::google_calendar::run_once(&pool,&transport,"2026-09-22T00:01:00Z".parse().unwrap()).await.unwrap();
    let calls=transport.calls.lock().unwrap();
    assert!(calls.iter().all(|line|line.contains("owned-calendar")));
    assert_eq!(calls.iter().filter(|line|line.starts_with("insert:")).count(),1);
    assert!(calls.iter().any(|line|line.contains(&event_id)));
    assert_eq!(db::state(&pool).await.unwrap().sync_token.as_deref(),Some("token-2"));
}

#[tokio::test]
async fn pending_delete_refreshes_stale_etag_and_never_deletes_unowned_event() {
    use nimble_core::{api::google_calendar::{CalendarApi,CalendarApiError},db::{google_calendar as db,tasks},types::{CreateTaskInput,UpdateTaskInput}};
    use serde_json::Value;
    use std::sync::Mutex;
    struct FakeDelete { event:Value, etags:Mutex<Vec<String>>, wrong_marker:bool }
    impl CalendarApi for FakeDelete {
        async fn list_page(&self,c:&str,_:Option<&str>,_:Option<&str>)->Result<(Vec<Value>,Option<String>,Option<String>),CalendarApiError>{assert_eq!(c,"owned-calendar");Ok((vec![],None,Some("next".into())))}
        async fn get_raw(&self,c:&str,_:&str)->Result<Value,CalendarApiError>{assert_eq!(c,"owned-calendar");let mut v=self.event.clone(); if self.wrong_marker {v["extendedProperties"]["private"]["nimbleTaskId"]="other".into();} else if !self.etags.lock().unwrap().is_empty(){v["etag"]="fresh-2".into();} Ok(v)}
        async fn get(&self,_:&str,_:&str)->Result<nimble_core::integrations::google_calendar::RemoteEvent,CalendarApiError>{panic!("unexpected")}
        async fn insert(&self,_:&str,_:&str,_:&CalendarProjection)->Result<nimble_core::integrations::google_calendar::RemoteEvent,CalendarApiError>{panic!("unexpected")}
        async fn update(&self,_:&str,_:&str,_:&CalendarProjection,_:&str,_:&Value)->Result<nimble_core::integrations::google_calendar::RemoteEvent,CalendarApiError>{panic!("unexpected")}
        async fn delete(&self,c:&str,_:&str,e:Option<&str>)->Result<(),CalendarApiError>{assert_eq!(c,"owned-calendar");let etag=e.unwrap_or("").to_string();self.etags.lock().unwrap().push(etag.clone());if etag=="fresh-1"{Err(CalendarApiError::Precondition)}else{Ok(())}}
    }
    let pool=nimble_core::test_util::test_pool().await;
    db::set_calendar(&pool,"owned-calendar","America/Los_Angeles").await.unwrap();
    let task=tasks::create_local_task(&pool,CreateTaskInput {content:"Delete".into(),due_date:Some("2026-09-22".into()),due_time:Some("09:00".into()),reminder_offset_minutes:Some(30),google_calendar_enabled:Some(true),..Default::default()}).await.unwrap();
    let p=nimble_core::integrations::google_calendar::project(&task,"America/Los_Angeles").unwrap().unwrap();
    let id=event_id(&task.id);
    db::queue_upsert(&pool,&task.id,&id,&p).await.unwrap();db::acknowledge_upsert(&pool,&task.id,Some("old-etag"),&p).await.unwrap();
    tasks::update_local_task(&pool,&task.id,UpdateTaskInput {google_calendar_enabled:Some(false),..Default::default()}).await.unwrap();
    let mut event=nimble_core::api::google_calendar::event_body(&id,&p); event["etag"]="fresh-1".into();
    let fake=FakeDelete {event:event.clone(),etags:Mutex::new(vec![]),wrong_marker:false};
    nimble_core::integrations::google_calendar::run_once(&pool,&fake,"2026-09-22T00:00:00Z".parse().unwrap()).await.unwrap();
    assert_eq!(*fake.etags.lock().unwrap(),vec!["fresh-1","fresh-2"]);
    assert!(db::links(&pool).await.unwrap().is_empty());
    db::queue_upsert(&pool,&task.id,&id,&p).await.unwrap();db::acknowledge_upsert(&pool,&task.id,Some("old-etag"),&p).await.unwrap();
    let wrong=FakeDelete {event,etags:Mutex::new(vec![]),wrong_marker:true};
    let result=nimble_core::integrations::google_calendar::run_once(&pool,&wrong,"2026-09-22T00:01:00Z".parse().unwrap()).await.unwrap();
    assert_eq!(result.error_code.as_deref(),Some("google_event_conflict"));
    assert!(wrong.etags.lock().unwrap().is_empty());
    assert_eq!(db::links(&pool).await.unwrap().len(),1);
}
