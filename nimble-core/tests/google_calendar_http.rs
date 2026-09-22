use nimble_core::{api::google_calendar::{CalendarApiError,CalendarTransport},integrations::google_calendar::{CalendarProjection,event_id}};
use tokio::{io::{AsyncReadExt,AsyncWriteExt},net::TcpListener};

async fn listener() -> Option<TcpListener> {
    match TcpListener::bind("127.0.0.1:0").await {
        Ok(v)=>Some(v),
        Err(e) if e.kind()==std::io::ErrorKind::PermissionDenied => { eprintln!("local socket denied by sandbox; run this test with loopback permission"); None },
        Err(e)=>panic!("loopback bind failed: {e}"),
    }
}

async fn serve_one(listener:&TcpListener,status:u16,body:&str,extra:&str)->String {
    let (mut stream,_)=listener.accept().await.unwrap();
    let mut bytes=Vec::new(); let mut chunk=[0u8;4096];
    loop {
        let n=stream.read(&mut chunk).await.unwrap(); if n==0 {break} bytes.extend_from_slice(&chunk[..n]);
        if let Some(end)=bytes.windows(4).position(|v|v==b"\r\n\r\n") {
            let header=String::from_utf8_lossy(&bytes[..end+4]);
            let len=header.lines().find_map(|line|line.to_ascii_lowercase().strip_prefix("content-length:").and_then(|v|v.trim().parse::<usize>().ok())).unwrap_or(0);
            if bytes.len()>=end+4+len {break}
        }
    }
    let request=String::from_utf8_lossy(&bytes).into_owned();
    let reason=if status==200{"OK"}else if status==429{"Too Many Requests"}else{"Server Error"};
    let response=format!("HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{body}",body.len());
    stream.write_all(response.as_bytes()).await.unwrap();
    request
}

fn projection()->CalendarProjection { CalendarProjection {task_id:"f41f0ec4-9402-4631-a84d-125a793df248".into(),content:"Title".into(),description:"Note".into(),start_rfc3339:"2026-09-22T16:00:00+00:00".into(),end_rfc3339:"2026-09-22T16:30:00+00:00".into(),timezone:"America/Los_Angeles".into(),reminder_offset_minutes:30} }

#[tokio::test]
async fn exact_transport_path_query_auth_etag_and_retry_after() {
    let Some(listener)=listener().await else {return};
    let port=listener.local_addr().unwrap().port();
    let p=projection();let id=event_id(&p.task_id);
    let mut event=nimble_core::api::google_calendar::event_body(&id,&p);
    event["etag"]="etag-1".into(); event["location"]="keep me".into();
    let event_json=event.to_string();
    let server=tokio::spawn(async move {
        let a=serve_one(&listener,200,r#"{"items":[],"nextSyncToken":"next"}"#,"").await;
        let b=serve_one(&listener,200,&event_json,"").await;
        let c=serve_one(&listener,200,&event_json,"").await;
        let d=serve_one(&listener,429,r#"{"error":{"errors":[{"reason":"rateLimitExceeded"}]}}"#,"Retry-After: 17\r\n").await;
        (a,b,c,d)
    });
    let client=reqwest::Client::builder().no_proxy().build().unwrap();
    let transport=CalendarTransport::new(client,&format!("http://127.0.0.1:{port}/calendar/v3/"),"test-bearer".into()).unwrap();
    transport.list_page("owned-calendar",Some("a+b/c="),None).await.unwrap();
    let raw=transport.get_raw("owned-calendar",&id).await.unwrap();
    transport.update("owned-calendar",&id,&p,"etag-1",&raw).await.unwrap();
    assert_eq!(transport.list_page("owned-calendar",None,None).await.unwrap_err(),CalendarApiError::Retryable(Some(17)));
    let (a,b,c,d)=server.await.unwrap();
    assert!(a.starts_with("GET /calendar/v3/calendars/owned-calendar/events?"),"{a}");
    assert!(a.contains("syncToken=a%2Bb%2Fc%3D"),"{a}");
    assert!(a.contains("authorization: Bearer test-bearer")||a.contains("Authorization: Bearer test-bearer"),"{a}");
    assert!(b.starts_with(&format!("GET /calendar/v3/calendars/owned-calendar/events/{id} ")),"{b}");
    assert!(c.starts_with(&format!("PUT /calendar/v3/calendars/owned-calendar/events/{id} ")),"{c}");
    assert!(c.to_ascii_lowercase().contains("if-match: etag-1"),"{c}");
    assert!(c.contains("keep me"),"unrelated event fields must survive PUT");
    assert!(d.starts_with("GET /calendar/v3/calendars/owned-calendar/events?"),"{d}");
    assert!(![&a,&b,&c,&d].iter().any(|v|v.contains("/calendars//")));
}

#[tokio::test]
async fn failed_second_page_does_not_advance_sync_token() {
    let Some(listener)=listener().await else {return};
    let port=listener.local_addr().unwrap().port();
    let server=tokio::spawn(async move {
        let a=serve_one(&listener,200,r#"{"items":[],"nextPageToken":"page+2"}"#,"").await;
        let b=serve_one(&listener,503,r#"{"error":"unavailable"}"#,"").await;
        (a,b)
    });
    let pool=nimble_core::test_util::test_pool().await;
    nimble_core::db::google_calendar::set_calendar(&pool,"owned-calendar","UTC").await.unwrap();
    nimble_core::db::google_calendar::set_sync_token(&pool,Some("old-token")).await.unwrap();
    let transport=CalendarTransport::new(reqwest::Client::builder().no_proxy().build().unwrap(),&format!("http://127.0.0.1:{port}/calendar/v3/"),"fake".into()).unwrap();
    let result=nimble_core::integrations::google_calendar::run_once(&pool,&transport,"2026-09-22T00:00:00Z".parse().unwrap()).await.unwrap();
    assert_eq!(result.error_code.as_deref(),Some("google_retry_later"));
    assert_eq!(nimble_core::db::google_calendar::state(&pool).await.unwrap().sync_token.as_deref(),Some("old-token"));
    let (a,b)=server.await.unwrap();
    assert!(a.contains("syncToken=old-token"));
    assert!(b.contains("pageToken=page%2B2"));
}
