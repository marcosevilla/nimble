//! Base spec §3.6 / addendum §5: nothing under `src/brief/` can complete,
//! reschedule, delete or send. The brief suggests; the user acts through the
//! task commands. Every file in `brief/` is scanned the day it lands. Items
//! marked `#[cfg(test)]` (a file's `mod tests`, or a test-only helper) are not
//! scanned — tests may set up tasks directly — but production code after them
//! still is.

use std::path::{Path, PathBuf};

/// Calls and SQL that change a task, drive an integration or reach the network.
const FORBIDDEN: &[&str] = &[
    "update_task_status", "update_local_task", "delete_local_task", "task_tx::", "set_task_labels",
    "reschedule", "complete_task", "uncomplete", ".complete(", "send_commands", ".send(", "reqwest",
    "integrations::", "google_calendar::", "UPDATE local_tasks", "DELETE FROM local_tasks", "INSERT INTO local_tasks",
];

/// A `db::<module>::<fn>` call whose name starts like this writes data…
const WRITE_VERBS: &[&str] = &[
    "delete_", "update_", "set_", "create_", "insert_", "remove_", "complete_", "uncomplete_", "log_", "unlog_",
    "reorder_", "move_", "archive_", "apply_", "push_", "send_", "snooze_", "reschedule_", "migrate_",
];
/// …which the brief may only do to its own tables.
const WRITABLE: &[&str] = &["briefs", "brief_items", "module_cache", "settings", "activity"];

/// The line with its `//` comment removed.
fn code_of(line: &str) -> &str {
    line.split("//").next().unwrap_or("")
}

/// `(line number, code)` for every line outside a `#[cfg(test)]` item. The
/// item after the attribute is skipped up to its matching closing brace (or
/// its `;` for a brace-less item such as a `use`), then scanning resumes.
fn scanned(src: &str) -> Vec<(usize, &str)> {
    let mut out = Vec::new();
    let mut skipping = false;
    let mut depth: i32 = 0;
    let mut opened = false;
    for (i, line) in src.lines().enumerate() {
        let code = code_of(line);
        if !skipping {
            if code.trim_start().starts_with("#[cfg(test)]") {
                skipping = true;
                depth = 0;
                opened = false;
            } else {
                out.push((i + 1, code));
            }
            continue;
        }
        let rest = code.trim_start().strip_prefix("#[cfg(test)]").unwrap_or(code);
        for ch in rest.chars() {
            match ch {
                '{' => {
                    depth += 1;
                    opened = true;
                }
                '}' => depth -= 1,
                _ => {}
            }
        }
        if (opened && depth <= 0) || (!opened && rest.trim_end().ends_with(';')) {
            skipping = false;
        }
    }
    out
}

fn ident(s: &str) -> &str {
    let end = s.find(|c: char| !(c.is_alphanumeric() || c == '_')).unwrap_or(s.len());
    &s[..end]
}

fn violations(src: &str) -> Vec<String> {
    let mut out = Vec::new();
    for (n, code) in scanned(src) {
        for f in FORBIDDEN {
            if code.contains(f) {
                out.push(format!("line {n}: `{f}`"));
            }
        }
        let mut rest = code;
        while let Some(at) = rest.find("db::") {
            rest = &rest[at + 4..];
            let module = ident(rest);
            if let Some(tail) = rest[module.len()..].strip_prefix("::") {
                let func = ident(tail);
                if WRITE_VERBS.iter().any(|v| func.starts_with(v)) && !WRITABLE.contains(&module) {
                    out.push(format!("line {n}: `db::{module}::{func}` writes outside the brief's own tables"));
                }
            }
        }
    }
    out
}

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

#[test]
fn the_scanner_catches_what_it_should() {
    assert!(!violations("crate::db::tasks::update_task_status(&pool, id, \"complete\", None).await?;").is_empty());
    assert!(!violations("crate::db::labels::set_task_labels(pool, id, &ids)").is_empty());
    assert!(!violations("crate::db::projects::delete_project(pool, id)").is_empty());
    assert!(!violations("crate::db::habits::log_habit(pool, id, None, None)").is_empty());
    assert!(!violations("let c = reqwest::Client::new();").is_empty());
    assert!(!violations("sqlx::query(\"UPDATE local_tasks SET due_date = ?\")").is_empty());
    assert!(!violations("crate::integrations::todoist::push(pool)").is_empty());
    assert!(violations("crate::db::tasks::get_local_tasks(pool, None, None, false)").is_empty());
    assert!(violations("crate::db::brief_items::set_item_state(pool, id, s, None, None)").is_empty());
    assert!(violations("crate::db::briefs::record_composition(pool, &rec)").is_empty());
    assert!(violations("\"SELECT id FROM local_tasks WHERE status != 'complete'\"").is_empty());
    assert!(violations("// update_task_status is never called here").is_empty());
}

#[test]
fn test_only_code_is_skipped_but_code_after_it_is_not() {
    // A trailing `mod tests` may touch tasks directly.
    assert!(violations("fn ok() {}\n#[cfg(test)]\nmod tests { fn t() { crate::db::tasks::update_task_status(); } }").is_empty());
    let multi_line = "fn ok() {}\n#[cfg(test)]\nmod tests {\n    fn t() {\n        crate::db::tasks::update_task_status();\n    }\n}\n";
    assert!(violations(multi_line).is_empty());
    assert!(violations("#[cfg(test)]\nuse crate::db::tasks::update_task_status;\nfn ok() {}").is_empty());
    // Production code after a mid-file test item is still scanned.
    let after = "#[cfg(test)]\nfn helper() {\n    crate::db::tasks::update_task_status();\n}\n\npub fn real() {\n    crate::db::tasks::delete_local_task();\n}\n";
    let v = violations(after);
    assert!(!v.is_empty() && v.iter().all(|x| x.starts_with("line 7:")), "only the production line is flagged: {v:?}");
    let after_use = "#[cfg(test)]\nuse crate::test_util::test_pool;\nfn real() { let _ = reqwest::Client::new(); }";
    let v = violations(after_use);
    assert!(!v.is_empty() && v.iter().all(|x| x.starts_with("line 3:")), "{v:?}");
}

#[test]
fn nothing_in_brief_can_complete_reschedule_delete_or_send() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/brief");
    let mut files = Vec::new();
    rust_files(&root, &mut files);
    files.sort();
    let names: Vec<String> = files.iter().map(|f| f.strip_prefix(&root).unwrap().display().to_string()).collect();
    for expected in ["mod.rs", "candidates.rs", "prompt.rs", "validate.rs", "fallback.rs", "compose.rs", "modules/quick_wins.rs"] {
        assert!(names.iter().any(|n| n == expected), "the scan must cover {expected}; found {names:?}");
    }
    let mut found = Vec::new();
    for file in &files {
        for v in violations(&std::fs::read_to_string(file).unwrap()) {
            found.push(format!("{}: {v}", file.strip_prefix(&root).unwrap().display()));
        }
    }
    assert!(found.is_empty(), "brief/ may only suggest (base spec §3.6):\n{}", found.join("\n"));
}
