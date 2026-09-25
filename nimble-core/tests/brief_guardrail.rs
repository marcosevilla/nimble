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

fn is_ident(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// `src` with comments turned into spaces (newlines kept, so line numbers
/// hold). String and char literals are kept as they are, or blanked when
/// `blank_strings` (for brace counting). A small lexer: line and nested block
/// comments, escapes, raw strings (`r#"…"#`, `br"…"`), and char literals vs.
/// lifetimes.
fn strip(src: &str, blank_strings: bool) -> String {
    let c: Vec<char> = src.chars().collect();
    let mut out = String::with_capacity(src.len());
    let blank = |ch: char| if ch == '\n' { '\n' } else { ' ' };
    let lit = |ch: char| if blank_strings { blank(ch) } else { ch };
    let mut i = 0;
    while i < c.len() {
        let ch = c[i];
        let next = c.get(i + 1).copied();
        if ch == '/' && next == Some('/') {
            while i < c.len() && c[i] != '\n' {
                out.push(' ');
                i += 1;
            }
        } else if ch == '/' && next == Some('*') {
            let mut depth = 0;
            while i < c.len() {
                if c[i] == '/' && c.get(i + 1) == Some(&'*') {
                    depth += 1;
                    out.push_str("  ");
                    i += 2;
                } else if c[i] == '*' && c.get(i + 1) == Some(&'/') {
                    depth -= 1;
                    out.push_str("  ");
                    i += 2;
                    if depth == 0 {
                        break;
                    }
                } else {
                    out.push(blank(c[i]));
                    i += 1;
                }
            }
        } else if ch == 'r' && (next == Some('"') || next == Some('#')) && (i == 0 || !is_ident(c[i - 1]) || (c[i - 1] == 'b' && (i < 2 || !is_ident(c[i - 2])))) {
            // Raw string: r"…", r#"…"#, … (the `b` of br"…" was already pushed).
            let mut j = i + 1;
            while c.get(j) == Some(&'#') {
                j += 1;
            }
            if c.get(j) != Some(&'"') {
                out.push(ch);
                i += 1;
                continue;
            }
            let hashes = j - i - 1;
            out.extend(c[i..=j].iter());
            i = j + 1;
            while i < c.len() {
                if c[i] == '"' && (0..hashes).all(|k| c.get(i + 1 + k) == Some(&'#')) {
                    out.extend(c[i..i + 1 + hashes].iter());
                    i += 1 + hashes;
                    break;
                }
                out.push(lit(c[i]));
                i += 1;
            }
        } else if ch == '"' {
            out.push('"');
            i += 1;
            while i < c.len() {
                if c[i] == '\\' {
                    out.push(lit(c[i]));
                    if let Some(&e) = c.get(i + 1) {
                        out.push(lit(e));
                    }
                    i += 2;
                } else if c[i] == '"' {
                    out.push('"');
                    i += 1;
                    break;
                } else {
                    out.push(lit(c[i]));
                    i += 1;
                }
            }
        } else if ch == '\'' && (next == Some('\\') || c.get(i + 2) == Some(&'\'')) {
            // A char literal ('x', '\n', '\'', '\u{..}'); a lifetime has no closing quote.
            let mut j = i + 1;
            if c.get(j) == Some(&'\\') {
                j += 2;
            } else {
                j += 1;
            }
            while j < c.len() && c[j] != '\'' {
                j += 1;
            }
            out.push('\'');
            for &x in &c[i + 1..j.min(c.len())] {
                out.push(lit(x));
            }
            out.push('\'');
            i = j + 1;
        } else {
            out.push(ch);
            i += 1;
        }
    }
    out
}

/// `(line number, code)` for every line outside a `#[cfg(test)]` item, with
/// comments removed and string contents kept. The item after the attribute
/// is skipped up to its matching closing brace (or its `;` for a brace-less
/// item such as a `use`), then scanning resumes. Braces are counted with
/// strings blanked, so a `"}"` can't end the skip early.
fn scanned(src: &str) -> Vec<(usize, String)> {
    let code = strip(src, false);
    let skeleton = strip(src, true);
    let mut out = Vec::new();
    let mut skipping = false;
    let mut depth: i32 = 0;
    let mut opened = false;
    for (i, (line, shape)) in code.lines().zip(skeleton.lines()).enumerate() {
        if !skipping {
            if shape.trim_start().starts_with("#[cfg(test)]") {
                skipping = true;
                depth = 0;
                opened = false;
            } else {
                out.push((i + 1, line.to_string()));
            }
            continue;
        }
        let rest = shape.trim_start().strip_prefix("#[cfg(test)]").unwrap_or(shape);
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
    let end = s.find(|c: char| !is_ident(c)).unwrap_or(s.len());
    &s[..end]
}

fn writes_elsewhere(module: &str, func: &str) -> bool {
    WRITE_VERBS.iter().any(|v| func.starts_with(v)) && !WRITABLE.contains(&module)
}

/// Splits `a, b::{c, d}, e` at top-level commas.
fn split_top(s: &str) -> Vec<&str> {
    let (mut parts, mut depth, mut from) = (Vec::new(), 0, 0);
    for (i, ch) in s.char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => depth -= 1,
            ',' if depth == 0 => {
                parts.push(&s[from..i]);
                from = i + 1;
            }
            _ => {}
        }
    }
    parts.push(&s[from..]);
    parts.into_iter().map(str::trim).filter(|p| !p.is_empty()).collect()
}

/// Every `(path, alias)` a use tree brings in: `a::{b as c, d::{self}}` →
/// `("a::b", Some("c"))`, `("a::d::self", None)`.
fn expand_use(tree: &str, prefix: &str, out: &mut Vec<(String, Option<String>)>) {
    let tree = tree.trim();
    if let Some(open) = tree.find('{') {
        let close = tree.rfind('}').unwrap_or(tree.len());
        let head = format!("{prefix}{}", &tree[..open]);
        for part in split_top(&tree[open + 1..close]) {
            expand_use(part, &head, out);
        }
    } else {
        let (path, alias) = match tree.split_once(" as ") {
            Some((p, a)) => (p.trim(), Some(a.trim().to_string())),
            None => (tree, None),
        };
        out.push((format!("{prefix}{path}"), alias));
    }
}

/// Names that stand for `db` itself or for a `db::<module>`, from the file's
/// `use` statements, plus any imported write function outside the brief's
/// own tables (a violation at its line).
struct DbNames {
    db: Vec<String>,
    modules: Vec<(String, String)>,
}

fn db_names(lines: &[(usize, String)], out: &mut Vec<String>) -> DbNames {
    let mut names = DbNames { db: vec!["db".into()], modules: Vec::new() };
    let mut stmt: Option<(usize, String)> = None;
    for (n, code) in lines {
        let t = code.trim_start();
        let t = t.strip_prefix("pub(crate) ").or_else(|| t.strip_prefix("pub ")).unwrap_or(t);
        if stmt.is_none() && t.starts_with("use ") {
            stmt = Some((*n, String::new()));
        }
        let Some((start, text)) = stmt.as_mut() else { continue };
        text.push_str(code);
        text.push(' ');
        if !code.contains(';') {
            continue;
        }
        let body = text.trim().trim_start_matches("pub(crate) ").trim_start_matches("pub ");
        let body = body.trim_start_matches("use ").split(';').next().unwrap_or("");
        let mut paths = Vec::new();
        expand_use(body, "", &mut paths);
        for (path, alias) in paths {
            let segs: Vec<&str> = path.split("::").map(str::trim).filter(|s| !s.is_empty()).collect();
            let Some(at) = segs.iter().position(|s| *s == "db") else { continue };
            match &segs[at + 1..] {
                [] => names.db.extend(alias),
                [module] | [module, "self"] => names.modules.push((alias.unwrap_or_else(|| module.to_string()), module.to_string())),
                [module, func] => {
                    if writes_elsewhere(module, func) {
                        out.push(format!("line {start}: imports `db::{module}::{func}`, which writes outside the brief's own tables"));
                    }
                }
                _ => {}
            }
        }
        stmt = None;
    }
    names
}

/// Every `<name>::<ident>` in `code` where `name` starts at an identifier
/// boundary. `in_path`: `name` may also follow `::` (`crate::db::…`); an
/// alias may not, so `db::tasks::…` isn't read again as alias `tasks`.
fn paths_after<'a>(code: &'a str, name: &str, in_path: bool) -> Vec<&'a str> {
    let needle = format!("{name}::");
    let mut found = Vec::new();
    let mut from = 0;
    while let Some(at) = code[from..].find(&needle) {
        let start = from + at;
        let before = code[..start].chars().next_back();
        let boundary = before.is_none_or(|b| !is_ident(b) && (in_path || b != ':'));
        from = start + needle.len();
        if boundary {
            found.push(&code[from..]);
        }
    }
    found
}

fn violations(src: &str) -> Vec<String> {
    let lines = scanned(src);
    let mut out = Vec::new();
    let names = db_names(&lines, &mut out);
    for (n, code) in &lines {
        for f in FORBIDDEN {
            if code.contains(f) {
                out.push(format!("line {n}: `{f}`"));
            }
        }
        // `db::<module>::<fn>` (also through an alias for `db`).
        for db in &names.db {
            for rest in paths_after(code, db, true) {
                let module = ident(rest);
                if let Some(tail) = rest[module.len()..].strip_prefix("::") {
                    let func = ident(tail);
                    if writes_elsewhere(module, func) {
                        out.push(format!("line {n}: `db::{module}::{func}` writes outside the brief's own tables"));
                    }
                }
            }
        }
        // `<alias>::<fn>` for an imported `db::<module>`.
        for (alias, module) in &names.modules {
            for rest in paths_after(code, alias, false) {
                let func = ident(rest);
                if writes_elsewhere(module, func) {
                    out.push(format!("line {n}: `{alias}::{func}` (db::{module}) writes outside the brief's own tables"));
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
fn only_real_comments_are_stripped() {
    // `//` inside a string is not a comment: the rest of the line is still code.
    assert!(!violations("let u = \"https://api.example.com\"; crate::db::tasks::update_task_status(x);").is_empty());
    assert!(violations("let u = \"https://api.example.com\"; // update_task_status later").is_empty());
    assert!(violations("/* crate::db::tasks::update_task_status() */ fn ok() {}").is_empty());
    assert!(violations("/*\n  delete_local_task\n*/\nfn ok() {}").is_empty());
    // A '"' char literal doesn't open a string.
    assert!(!violations("let q = '\"'; crate::db::tasks::update_task_status();").is_empty());
    // SQL inside strings is still scanned, raw strings included.
    assert!(!violations("sqlx::query(r#\"UPDATE local_tasks SET x = 1 -- \"//\"\"#)").is_empty());
    // Braces inside a test item's strings don't end the skip early.
    let braces = "#[cfg(test)]\nmod tests {\n    const S: &str = \"}\";\n    fn t() { crate::db::tasks::update_task_status(); }\n}\nfn ok() {}\n";
    assert!(violations(braces).is_empty(), "{:?}", violations(braces));
}

#[test]
fn aliased_db_imports_are_resolved() {
    assert!(!violations("use crate::db::projects as p;\nfn f() { p::delete_project(pool); }").is_empty());
    assert!(!violations("use crate::db::{tasks, projects as pr};\nfn f() { pr::archive_project(pool); }").is_empty());
    assert!(!violations("use crate::db::projects::{self as pj};\nfn f() { pj::delete_project(pool); }").is_empty());
    assert!(!violations("use crate::db::projects;\nfn f() { projects::delete_project(pool); }").is_empty());
    assert!(!violations("use crate::db::projects::delete_project;").is_empty());
    assert!(!violations("use crate::db as store;\nfn f() { store::projects::delete_project(pool); }").is_empty());
    assert!(!violations("use crate::{\n    db::projects as p,\n};\nfn f() { p::delete_project(pool); }").is_empty());
    // Reads and the brief's own tables stay allowed.
    assert!(violations("use crate::db::tasks as t;\nfn f() { t::get_local_tasks(pool); }").is_empty());
    assert!(violations("use crate::db::brief_items::{self, NewBriefItem};\nfn f() { brief_items::set_item_state(pool); }").is_empty());
    assert!(violations("use crate::db::briefs::{self, CompositionRecord};\nfn f() { briefs::record_composition(pool); }").is_empty());
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
