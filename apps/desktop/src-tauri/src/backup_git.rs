//! Private-only, explicit-path Git publication. All subprocess diagnostics are codes.
use crate::backup_state::{atomic_private_write, error, plain_file, RemoteConfig};
use nimble_core::Result;
use serde::{Deserialize, Serialize};
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
};
const FILES: [&str; 2] = ["export/data.json", "export/format.json"];
const OUTPUT_LIMIT: usize = 1024 * 1024;
#[derive(Debug)]
pub struct PublishResult {
    pub commit: String,
    pub acknowledged_at: String,
}

#[derive(Clone)]
struct Tools {
    git: PathBuf,
    gh: PathBuf,
    timeout: Duration,
}
impl Default for Tools {
    fn default() -> Self {
        Self {
            git: "git".into(),
            gh: "gh".into(),
            timeout: Duration::from_secs(60),
        }
    }
}
struct Output {
    success: bool,
    bytes: Vec<u8>,
}
async fn bounded_read(mut reader: impl AsyncRead + Unpin) -> std::io::Result<(Vec<u8>, bool)> {
    let mut result = Vec::new();
    let mut buffer = [0; 8192];
    let mut overflow = false;
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 {
            break;
        }
        let keep = count.min(OUTPUT_LIMIT.saturating_sub(result.len()));
        result.extend_from_slice(&buffer[..keep]);
        overflow |= keep != count;
    }
    Ok((result, overflow))
}
impl Tools {
    async fn run(&self, program: &Path, args: &[&str], cwd: Option<&Path>) -> Result<Output> {
        let mut command = Command::new(program);
        command
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GCM_INTERACTIVE", "never")
            .env("GH_HOST", "github.com");
        // Do not let an inherited Git environment select a different worktree/index/config.
        for (name, _) in std::env::vars_os() {
            if name.to_string_lossy().starts_with("GIT_") {
                command.env_remove(name);
            }
        }
        command.env("GIT_TERMINAL_PROMPT", "0");
        if let Some(path) = cwd {
            command.current_dir(path);
        }
        let mut child = command
            .spawn()
            .map_err(|_| error("backup_tool_unavailable"))?;
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let result = tokio::time::timeout(self.timeout, async {
            let (status, out, err) =
                tokio::join!(child.wait(), bounded_read(stdout), bounded_read(stderr));
            let status = status.map_err(|_| error("backup_process_failed"))?;
            let (bytes, overflow) = out.map_err(|_| error("backup_process_failed"))?;
            let (_, stderr_overflow) = err.map_err(|_| error("backup_process_failed"))?;
            if overflow || stderr_overflow {
                return Err(error("backup_output_limit"));
            }
            Ok(Output {
                success: status.success(),
                bytes,
            })
        })
        .await;
        match result {
            Ok(value) => value,
            Err(_) => {
                let _ = child.kill().await;
                Err(error("backup_process_timeout"))
            }
        }
    }
    async fn git(&self, root: &Path, args: &[&str]) -> Result<Output> {
        let hooks =
            std::env::temp_dir().join(format!("nimble-empty-hooks-{}", uuid::Uuid::new_v4()));
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&hooks)
            .map_err(|_| error("hooks_directory_failed"))?;
        let hook_config = format!("core.hooksPath={}", hooks.display());
        let mut full_args = vec![
            "-c",
            &hook_config,
            "-c",
            "core.attributesFile=/dev/null",
            "-c",
            "commit.gpgSign=false",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.fsync=committed",
            "-c",
            "core.fsyncMethod=fsync",
        ];
        full_args.extend_from_slice(args);
        let result = self.run(&self.git, &full_args, Some(root)).await;
        let _ = fs::remove_dir(hooks);
        result
    }
    async fn text(&self, root: &Path, args: &[&str]) -> Result<String> {
        let output = self.git(root, args).await?;
        if !output.success {
            return Err(error("backup_git_failed"));
        }
        String::from_utf8(output.bytes).map_err(|_| error("backup_git_invalid_output"))
    }
    async fn privacy(&self, name: &str, expected: Option<&str>) -> Result<String> {
        validate_name(name)?;
        let output = self
            .run(
                &self.gh,
                &[
                    "repo",
                    "view",
                    name,
                    "--json",
                    "id,visibility,nameWithOwner",
                ],
                None,
            )
            .await?;
        if !output.success {
            return Err(error("remote_privacy_unverified"));
        }
        #[derive(Deserialize)]
        struct Identity {
            id: String,
            visibility: String,
            #[serde(rename = "nameWithOwner")]
            name: String,
        }
        let identity: Identity = serde_json::from_slice(&output.bytes)
            .map_err(|_| error("remote_privacy_unverified"))?;
        if identity.visibility != "PRIVATE"
            || identity.id.is_empty()
            || !identity.name.eq_ignore_ascii_case(name)
        {
            return Err(error("remote_must_be_private"));
        }
        if expected.is_some_and(|id| id != identity.id) {
            return Err(error("remote_identity_changed"));
        }
        Ok(identity.id)
    }
}
fn validate_name(name: &str) -> Result<()> {
    let parts: Vec<_> = name.split('/').collect();
    if parts.len() != 2
        || parts.iter().any(|part| {
            part.is_empty()
                || part.len() > 100
                || part.starts_with(['-', '.'])
                || part.ends_with('.')
                || !part
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        })
    {
        return Err(error("invalid_repository_name"));
    }
    Ok(())
}
fn url(name: &str) -> String {
    format!("https://github.com/{name}.git")
}
fn allowed_url(value: &str, name: &str) -> bool {
    value == url(name) || value == format!("git@github.com:{name}.git")
}
fn private_directory(path: &Path) -> Result<()> {
    if !path.exists() {
        fs::DirBuilder::new()
            .mode(0o700)
            .create(path)
            .map_err(|_| error("backup_directory_failed"))?;
    }
    let meta = fs::symlink_metadata(path).map_err(|_| error("backup_directory_failed"))?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err(error("unsafe_backup_directory"));
    }
    Ok(())
}
fn check_files(root: &Path) -> Result<()> {
    private_directory(root)?;
    for entry in fs::read_dir(root).map_err(|_| error("backup_directory_failed"))? {
        let entry = entry.map_err(|_| error("backup_directory_failed"))?;
        let name = entry.file_name();
        let path = entry.path();
        if name == ".git" {
            private_directory(&path)?;
        } else if name == "export" {
            private_directory(&path)?;
            for file in fs::read_dir(&path).map_err(|_| error("backup_directory_failed"))? {
                let file = file.map_err(|_| error("backup_directory_failed"))?;
                if file.file_name() != "data.json" && file.file_name() != "format.json" {
                    return Err(error("unexpected_backup_files"));
                }
                plain_file(&file.path())?;
            }
        } else {
            return Err(error("unexpected_backup_files"));
        }
    }
    for marker in [
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "rebase-merge",
        "rebase-apply",
        "sequencer",
        "commondir",
    ] {
        if root.join(".git").join(marker).symlink_metadata().is_ok() {
            return Err(error("backup_repository_operation_in_progress"));
        }
    }
    let attributes = root.join(".git/info/attributes");
    if attributes.symlink_metadata().is_ok() {
        plain_file(&attributes)?;
    }
    if attributes.exists()
        && fs::metadata(attributes)
            .map_err(|_| error("unsafe_git_attributes"))?
            .len()
            > 0
    {
        return Err(error("unsafe_git_attributes"));
    }
    Ok(())
}
async fn inspect(tools: &Tools, root: &Path, name: &str, clean: bool) -> Result<()> {
    if !root.exists() {
        return Err(error("backup_repository_missing"));
    }
    check_files(root)?;
    let top = tools.text(root, &["rev-parse", "--show-toplevel"]).await?;
    if fs::canonicalize(top.trim()).ok() != fs::canonicalize(root).ok() {
        return Err(error("unrelated_backup_repository"));
    }
    let git_dir = tools
        .text(root, &["rev-parse", "--absolute-git-dir"])
        .await?;
    if fs::canonicalize(git_dir.trim()).ok() != fs::canonicalize(root.join(".git")).ok() {
        return Err(error("unrelated_backup_repository"));
    }
    if tools
        .text(root, &["symbolic-ref", "--quiet", "HEAD"])
        .await?
        .trim()
        != "refs/heads/main"
    {
        return Err(error("backup_branch_must_be_main"));
    }
    if tools.text(root, &["remote"]).await?.trim() != "origin" {
        return Err(error("unexpected_backup_remote"));
    }
    let rewrites = tools
        .git(
            root,
            &[
                "config",
                "--get-regexp",
                r"^url\..*\.(insteadof|pushinsteadof)$",
            ],
        )
        .await?;
    if !rewrites.bytes.is_empty() {
        return Err(error("git_url_rewrite_refused"));
    }
    for key in [
        "remote.origin.vcs",
        "remote.origin.receivepack",
        "remote.origin.uploadpack",
        "remote.origin.proxy",
    ] {
        if !tools
            .git(root, &["config", "--get-all", key])
            .await?
            .bytes
            .is_empty()
        {
            return Err(error("unexpected_backup_transport"));
        }
    }
    let raw = tools
        .text(root, &["config", "--get-all", "remote.origin.url"])
        .await?;
    if raw.lines().count() != 1 || !allowed_url(raw.trim(), name) {
        return Err(error("unexpected_backup_remote"));
    }
    let push_raw = tools
        .git(root, &["config", "--get-all", "remote.origin.pushurl"])
        .await?;
    if !push_raw.bytes.is_empty() {
        let push =
            String::from_utf8(push_raw.bytes).map_err(|_| error("unexpected_backup_remote"))?;
        if push.lines().count() != 1 || push.trim() != raw.trim() {
            return Err(error("unexpected_backup_remote"));
        }
    }
    for args in [
        &["remote", "get-url", "--all", "origin"][..],
        &["remote", "get-url", "--push", "--all", "origin"][..],
    ] {
        let effective = tools.text(root, args).await?;
        if effective.lines().count() != 1 || effective.trim() != raw.trim() {
            return Err(error("unexpected_backup_remote"));
        }
    }
    // These flags can make status/add silently overlook changed export bytes.
    let flags = tools.text(root, &["ls-files", "-v"]).await?;
    if flags.lines().any(|line| !line.starts_with("H ")) {
        return Err(error("unsafe_backup_index_flags"));
    }
    let tracked = tools.text(root, &["ls-files", "--stage"]).await?;
    parse_tree(&tracked, true)?;
    let history = tools
        .git(root, &["log", "--all", "--format=", "--name-only"])
        .await?;
    if history.success {
        let names =
            String::from_utf8(history.bytes).map_err(|_| error("unexpected_backup_history"))?;
        if names
            .lines()
            .any(|line| !line.is_empty() && !FILES.contains(&line))
        {
            return Err(error("unexpected_backup_history"));
        }
    }
    if clean
        && !tools
            .text(root, &["status", "--porcelain=v1", "--untracked-files=all"])
            .await?
            .is_empty()
    {
        return Err(error("backup_repository_dirty"));
    }
    Ok(())
}
pub async fn configure_remote(owner_repo: &str, root: &Path) -> Result<RemoteConfig> {
    configure(&Tools::default(), owner_repo, root).await
}
async fn configure(tools: &Tools, owner_repo: &str, root: &Path) -> Result<RemoteConfig> {
    let id = tools.privacy(owner_repo, None).await?;
    let parent = root.parent().ok_or_else(|| error("invalid_backup_root"))?;
    private_directory(parent)?;
    if !root.exists() {
        let staging = parent.join(format!(".nimble-clone-{}", uuid::Uuid::new_v4()));
        let result = async {
            let destination = staging
                .to_str()
                .ok_or_else(|| error("invalid_backup_root"))?;
            let remote = url(owner_repo);
            let clone = tools
                .git(
                    parent,
                    &[
                        "clone",
                        "--no-checkout",
                        "--origin",
                        "origin",
                        "--",
                        &remote,
                        destination,
                    ],
                )
                .await?;
            if !clone.success {
                return Err(error("backup_clone_failed"));
            }
            fs::set_permissions(&staging, fs::Permissions::from_mode(0o700))
                .map_err(|_| error("backup_directory_failed"))?;
            // Empty remotes may advertise the historical default branch. Existing non-main histories are refused.
            let head = tools
                .git(&staging, &["rev-parse", "--verify", "HEAD"])
                .await?;
            if !head.success {
                tools
                    .text(&staging, &["symbolic-ref", "HEAD", "refs/heads/main"])
                    .await?;
            } else {
                // Validate committed paths before checkout can materialize anything.
                let tree = tools.text(&staging, &["ls-tree", "-r", "HEAD"]).await?;
                parse_tree(&tree, false)?;
                if tools
                    .text(&staging, &["symbolic-ref", "HEAD"])
                    .await?
                    .trim()
                    != "refs/heads/main"
                {
                    return Err(error("backup_branch_must_be_main"));
                }
                tools
                    .text(
                        &staging,
                        &[
                            "checkout",
                            "HEAD",
                            "--",
                            "export/data.json",
                            "export/format.json",
                        ],
                    )
                    .await?;
            }
            inspect(tools, &staging, owner_repo, true).await?;
            if root.exists() {
                return Err(error("backup_root_appeared"));
            }
            fs::rename(&staging, root).map_err(|_| error("backup_clone_publish_failed"))?;
            fs::File::open(parent)
                .and_then(|f| f.sync_all())
                .map_err(|_| error("backup_flush_failed"))?;
            Ok(())
        }
        .await;
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        result?;
    }
    inspect(tools, root, owner_repo, true).await?;
    Ok(RemoteConfig {
        owner_repo: owner_repo.into(),
        repository_id: id,
        root: fs::canonicalize(root).map_err(|_| error("invalid_backup_root"))?,
    })
}
fn parse_tree(text: &str, index: bool) -> Result<BTreeMap<String, String>> {
    let mut result = BTreeMap::new();
    for line in text.lines() {
        let (metadata, path) = line
            .split_once('\t')
            .ok_or_else(|| error("unexpected_backup_tree"))?;
        let columns: Vec<_> = metadata.split_whitespace().collect();
        if columns.len() != 3
            || columns[0] != "100644"
            || !FILES.contains(&path)
            || (index && columns[2] != "0")
            || (!index && columns[1] != "blob")
        {
            return Err(error("unexpected_backup_tree"));
        }
        result.insert(path.into(), columns[if index { 1 } else { 2 }].into());
    }
    Ok(result)
}
async fn head(tools: &Tools, root: &Path) -> Result<Option<String>> {
    let value = tools.git(root, &["rev-parse", "--verify", "HEAD"]).await?;
    if !value.success {
        return Ok(None);
    }
    Ok(Some(
        String::from_utf8(value.bytes)
            .map_err(|_| error("invalid_backup_head"))?
            .trim()
            .into(),
    ))
}
async fn tree(
    tools: &Tools,
    root: &Path,
    revision: Option<&str>,
) -> Result<BTreeMap<String, String>> {
    match revision {
        Some(rev) => parse_tree(&tools.text(root, &["ls-tree", "-r", rev]).await?, false),
        None => Ok(BTreeMap::new()),
    }
}
async fn hash(tools: &Tools, root: &Path, path: &Path) -> Result<String> {
    plain_file(path)?;
    Ok(tools
        .text(
            root,
            &[
                "hash-object",
                "--no-filters",
                "--",
                path.to_str().ok_or_else(|| error("invalid_export_path"))?,
            ],
        )
        .await?
        .trim()
        .into())
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    id: String,
    repository_id: String,
    prior_head: Option<String>,
    prior: BTreeMap<String, String>,
    target: BTreeMap<String, String>,
    bytes: BTreeMap<String, Vec<u8>>,
}
fn journal_path(root: &Path) -> Result<PathBuf> {
    let name = root
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| error("invalid_backup_root"))?;
    Ok(root.with_file_name(format!(".{name}.nimble-publish.json")))
}
async fn finish_journal(tools: &Tools, remote: &RemoteConfig, journal: &Journal) -> Result<()> {
    let root = &remote.root;
    if journal.repository_id != remote.repository_id
        || journal.target.len() != 2
        || journal.bytes.len() != 2
        || FILES
            .iter()
            .any(|p| !journal.target.contains_key(*p) || !journal.bytes.contains_key(*p))
    {
        return Err(error("backup_journal_invalid"));
    }
    inspect(tools, root, &remote.owner_repo, false).await?;
    // Validate the journal payload before changing an existing working file.
    let validation =
        std::env::temp_dir().join(format!("nimble-journal-check-{}", uuid::Uuid::new_v4()));
    private_directory(&validation)?;
    let checked = async {
        for path in FILES {
            let file = validation.join(Path::new(path).file_name().unwrap());
            atomic_private_write(&file, &journal.bytes[path])?;
            if hash(tools, root, &file).await? != journal.target[path] {
                return Err(error("backup_journal_invalid"));
            }
        }
        Ok(())
    }
    .await;
    let _ = fs::remove_dir_all(&validation);
    checked?;
    let current = head(tools, root).await?;
    if current != journal.prior_head {
        let revision = current
            .as_deref()
            .ok_or_else(|| error("backup_journal_conflict"))?;
        let parent = tools
            .text(root, &["rev-list", "--parents", "-n", "1", revision])
            .await?;
        let parents: Vec<_> = parent.split_whitespace().skip(1).collect();
        let expected: Vec<_> = journal.prior_head.iter().map(String::as_str).collect();
        let message = tools.text(root, &["log", "-1", "--format=%s"]).await?;
        if parents != expected
            || message.trim() != format!("Nimble backup {}", journal.id)
            || tree(tools, root, Some(revision)).await? != journal.target
        {
            return Err(error("backup_journal_conflict"));
        }
        inspect(tools, root, &remote.owner_repo, true).await?;
    } else {
        if tree(tools, root, current.as_deref()).await? != journal.prior {
            return Err(error("backup_journal_conflict"));
        }
        let index = parse_tree(&tools.text(root, &["ls-files", "--stage"]).await?, true)?;
        for path in FILES {
            let before = journal.prior.get(path);
            let after = journal.target.get(path);
            if index.get(path) != before && index.get(path) != after {
                return Err(error("backup_journal_conflict"));
            }
            let file = root.join(path);
            let working = if file.exists() {
                Some(hash(tools, root, &file).await?)
            } else {
                None
            };
            if working.as_ref() != before && working.as_ref() != after {
                return Err(error("backup_journal_conflict"));
            }
        }
        private_directory(&root.join("export"))?;
        for path in FILES {
            atomic_private_write(&root.join(path), &journal.bytes[path])?;
            if hash(tools, root, &root.join(path)).await? != journal.target[path] {
                return Err(error("backup_journal_invalid"));
            }
        }
        tools.text(root, &["add", "--", FILES[0], FILES[1]]).await?;
        let staged = tools
            .git(root, &["diff", "--cached", "--quiet", "--exit-code"])
            .await?;
        if !staged.success {
            let message = format!("Nimble backup {}", journal.id);
            tools
                .text(
                    root,
                    &[
                        "-c",
                        "user.name=Nimble Backup",
                        "-c",
                        "user.email=backup@nimble.local",
                        "commit",
                        "--no-verify",
                        "-m",
                        &message,
                    ],
                )
                .await?;
        }
        inspect(tools, root, &remote.owner_repo, true).await?;
        let committed = head(tools, root).await?;
        if tree(tools, root, committed.as_deref()).await? != journal.target {
            return Err(error("backup_commit_content_mismatch"));
        }
    }
    let journal_file = journal_path(root)?;
    fs::remove_file(&journal_file).map_err(|_| error("backup_journal_clear_failed"))?;
    fs::File::open(journal_file.parent().unwrap())
        .and_then(|f| f.sync_all())
        .map_err(|_| error("backup_flush_failed"))?;
    Ok(())
}
/// Read the validated local commit independently of offsite acknowledgement.
/// This remains available when GitHub cannot be reached; it never reports a push.
pub async fn current_commit(remote: &RemoteConfig) -> Result<Option<String>> {
    let tools = Tools::default();
    inspect(&tools, &remote.root, &remote.owner_repo, true).await?;
    head(&tools, &remote.root).await
}

/// Caller supplies the verified generation's export directory (containing data.json and format.json).
/// Caller serializes jobs with the backup OS lock. This function never selects an arbitrary remote.
pub async fn publish(remote: &RemoteConfig, export_directory: &Path) -> Result<PublishResult> {
    publish_with(&Tools::default(), remote, export_directory).await
}
async fn publish_with(
    tools: &Tools,
    remote: &RemoteConfig,
    export_directory: &Path,
) -> Result<PublishResult> {
    tools
        .privacy(&remote.owner_repo, Some(&remote.repository_id))
        .await?;
    let root = &remote.root;
    let journal_file = journal_path(root)?;
    if journal_file.exists() {
        plain_file(&journal_file)?;
        let journal: Journal = serde_json::from_slice(
            &fs::read(&journal_file).map_err(|_| error("backup_journal_read_failed"))?,
        )
        .map_err(|_| error("backup_journal_invalid"))?;
        finish_journal(tools, remote, &journal).await?;
    }
    inspect(tools, root, &remote.owner_repo, true).await?;
    let prior_head = head(tools, root).await?;
    let prior = tree(tools, root, prior_head.as_deref()).await?;
    let mut bytes = BTreeMap::new();
    let mut target = BTreeMap::new();
    for path in FILES {
        let source = export_directory.join(Path::new(path).file_name().unwrap());
        plain_file(&source)?;
        target.insert(path.into(), hash(tools, root, &source).await?);
        bytes.insert(
            path.into(),
            fs::read(&source).map_err(|_| error("export_read_failed"))?,
        );
    }
    if prior != target {
        let journal = Journal {
            id: uuid::Uuid::new_v4().to_string(),
            repository_id: remote.repository_id.clone(),
            prior_head,
            prior,
            target,
            bytes,
        };
        atomic_private_write(
            &journal_file,
            &serde_json::to_vec(&journal).map_err(|_| error("backup_journal_encode_failed"))?,
        )?;
        finish_journal(tools, remote, &journal).await?;
    }
    // Every push, including retries with unchanged bytes, rechecks identity and effective destination.
    tools
        .privacy(&remote.owner_repo, Some(&remote.repository_id))
        .await?;
    inspect(tools, root, &remote.owner_repo, true).await?;
    let commit = head(tools, root)
        .await?
        .ok_or_else(|| error("backup_commit_missing"))?;
    let pushed = tools
        .git(
            root,
            &["push", "--porcelain", "origin", "HEAD:refs/heads/main"],
        )
        .await?;
    if !pushed.success {
        return Err(error("backup_push_failed"));
    }
    let acknowledged = tools
        .text(
            root,
            &["ls-remote", "--exit-code", "origin", "refs/heads/main"],
        )
        .await?;
    if acknowledged.trim() != format!("{commit}\trefs/heads/main") {
        return Err(error("backup_push_not_acknowledged"));
    }
    Ok(PublishResult {
        commit,
        acknowledged_at: chrono::Utc::now().to_rfc3339(),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backup_git_owner_input_excludes_credentials_and_arguments() {
        for bad in [
            "a",
            "a/b/c",
            "https://token@github.com/a/b",
            "-x/b",
            "a/..",
            "a/b\n",
            "a/b.git?token=secret",
        ] {
            assert!(validate_name(bad).is_err(), "{bad}");
        }
        assert!(validate_name("owner/repo-name_1").is_ok());
    }
    struct Fixture {
        directory: PathBuf,
        bare: PathBuf,
        root: PathBuf,
        exports: PathBuf,
        tools: Tools,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.directory);
        }
    }
    fn script(path: &Path, content: &str) {
        fs::write(path, content).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
    }
    fn local_git(root: &Path, args: &[&str]) -> String {
        let output = std::process::Command::new("/usr/bin/git")
            .current_dir(root)
            .args(args)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "local fixture Git failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().into()
    }
    impl Fixture {
        fn new() -> Self {
            let directory =
                std::env::temp_dir().join(format!("nimble-git-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&directory).unwrap();
            let bare = directory.join("remote.git");
            let root = directory.join("archive");
            let exports = directory.join("generation");
            fs::create_dir(&exports).unwrap();
            fs::write(exports.join("data.json"), "{\"tasks\":[]}\n").unwrap();
            fs::write(exports.join("format.json"), "{\"version\":1}\n").unwrap();
            local_git(
                &directory,
                &[
                    "init",
                    "--bare",
                    "--initial-branch=main",
                    bare.to_str().unwrap(),
                ],
            );
            let gh = directory.join("gh");
            let git = directory.join("git");
            fs::write(
                directory.join("identity.json"),
                r#"{"id":"R_fixture","visibility":"PRIVATE","nameWithOwner":"owner/archive"}"#,
            )
            .unwrap();
            script(&gh, &format!("#!/usr/bin/env python3\nfrom pathlib import Path\nprint(Path({:?}).read_text())\n", directory.join("identity.json")));
            // This transport fixture preserves production URL validation and privacy checks;
            // only the final Git network transport is redirected to a disposable bare repo.
            script(
                &git,
                &format!(
                    r#"#!/usr/bin/env python3
import os, sys, subprocess
from pathlib import Path
args = sys.argv[1:]
root = Path({directory:?})
bare = {bare:?}
os.environ['GIT_CONFIG_NOSYSTEM'] = '1'
os.environ['GIT_CONFIG_GLOBAL'] = '/dev/null'
with (root / 'args.log').open('a') as f: f.write(repr(args) + '\n')
if 'push' in args or 'ls-remote' in args:
    if (root / 'offline').exists(): sys.exit(7)
    args = [bare if a == 'origin' else a for a in args]
if 'clone' in args:
    args = [bare if a == 'https://github.com/owner/archive.git' else a for a in args]
    result = subprocess.run(['/usr/bin/git'] + args)
    if result.returncode == 0: subprocess.check_call(['/usr/bin/git', '-C', args[-1], 'remote', 'set-url', 'origin', 'https://github.com/owner/archive.git'])
    sys.exit(result.returncode)
os.execv('/usr/bin/git', ['/usr/bin/git'] + args)
"#,
                    directory = directory.to_str().unwrap(),
                    bare = bare.to_str().unwrap()
                ),
            );
            Self {
                directory,
                bare,
                root,
                exports,
                tools: Tools {
                    git,
                    gh,
                    timeout: Duration::from_secs(10),
                },
            }
        }
        async fn configure(&self) -> RemoteConfig {
            configure(&self.tools, "owner/archive", &self.root)
                .await
                .unwrap()
        }
        async fn publish(&self, remote: &RemoteConfig) -> Result<PublishResult> {
            publish_with(&self.tools, remote, &self.exports).await
        }
    }
    #[tokio::test]
    async fn backup_git_pending_retry_unchanged_no_empty_commit_hooks_and_explicit_files() {
        let fixture = Fixture::new();
        let remote = fixture.configure().await;
        script(
            &fixture.root.join(".git/hooks/pre-commit"),
            "#!/bin/sh\nexit 99\n",
        );
        script(
            &fixture.root.join(".git/hooks/pre-push"),
            "#!/bin/sh\nexit 99\n",
        );
        fs::write(fixture.exports.join("snapshot.db"), "SENTINEL_SECRET").unwrap();
        fs::write(fixture.exports.join("manifest.json"), "SENTINEL_SECRET").unwrap();
        fs::write(fixture.directory.join("offline"), "").unwrap();
        assert!(fixture.publish(&remote).await.is_err());
        let pending = local_git(&fixture.root, &["rev-parse", "HEAD"]);
        fs::remove_file(fixture.directory.join("offline")).unwrap();
        let result = fixture.publish(&remote).await.unwrap();
        assert_eq!(pending, result.commit);
        assert_eq!(fixture.publish(&remote).await.unwrap().commit, pending);
        assert_eq!(
            local_git(&fixture.root, &["rev-list", "--count", "HEAD"]),
            "1"
        );
        assert_eq!(local_git(&fixture.bare, &["rev-parse", "main"]), pending);
        assert_eq!(
            local_git(&fixture.root, &["ls-tree", "-r", "--name-only", "HEAD"]),
            FILES.join("\n")
        );
        let args = fs::read_to_string(fixture.directory.join("args.log")).unwrap();
        for revision in local_git(&fixture.root, &["rev-list", "HEAD"]).lines() {
            for path in FILES {
                assert!(
                    !local_git(&fixture.root, &["show", &format!("{revision}:{path}")])
                        .contains("SENTINEL_SECRET")
                );
            }
        }
        assert!(!args.contains("SENTINEL_SECRET"));
        assert!(!args.contains("'add', '.'"));
    }
    #[tokio::test]
    async fn backup_git_privacy_identity_and_malformed_fail_before_mutation() {
        let fixture = Fixture::new();
        let remote = fixture.configure().await;
        for response in [
            r#"{"id":"R_fixture","visibility":"PUBLIC","nameWithOwner":"owner/archive"}"#,
            r#"{"id":"R_other","visibility":"PRIVATE","nameWithOwner":"owner/archive"}"#,
            "{}",
            "not json",
        ] {
            fs::write(fixture.directory.join("identity.json"), response).unwrap();
            assert!(fixture.publish(&remote).await.is_err());
            assert!(!fixture.root.join("export").exists());
        }
    }
    #[tokio::test]
    async fn backup_git_rejects_dirty_remote_rewrites_and_wrong_branch() {
        let fixture = Fixture::new();
        let remote = fixture.configure().await;
        fixture.publish(&remote).await.unwrap();
        fs::write(fixture.root.join("secret.txt"), "SENTINEL_SECRET").unwrap();
        assert!(fixture.publish(&remote).await.is_err());
        fs::remove_file(fixture.root.join("secret.txt")).unwrap();
        local_git(
            &fixture.root,
            &[
                "config",
                "--add",
                "remote.origin.pushurl",
                "https://token@github.com/owner/archive.git",
            ],
        );
        assert!(fixture.publish(&remote).await.is_err());
        local_git(
            &fixture.root,
            &["config", "--unset-all", "remote.origin.pushurl"],
        );
        local_git(
            &fixture.root,
            &[
                "config",
                "--add",
                "remote.origin.pushurl",
                "https://github.com/owner/archive.git",
            ],
        );
        local_git(
            &fixture.root,
            &[
                "config",
                "--add",
                "remote.origin.pushurl",
                "https://github.com/owner/archive.git",
            ],
        );
        assert!(fixture.publish(&remote).await.is_err());
        local_git(
            &fixture.root,
            &["config", "--unset-all", "remote.origin.pushurl"],
        );
        local_git(
            &fixture.root,
            &[
                "config",
                "url.https://elsewhere.invalid/.insteadOf",
                "https://github.com/",
            ],
        );
        assert!(fixture.publish(&remote).await.is_err());
        local_git(
            &fixture.root,
            &[
                "config",
                "--unset-all",
                "url.https://elsewhere.invalid/.insteadOf",
            ],
        );
        local_git(&fixture.root, &["checkout", "-b", "other"]);
        assert!(fixture.publish(&remote).await.is_err());
        assert!(
            !local_git(&fixture.bare, &["show", "main:export/data.json"])
                .contains("SENTINEL_SECRET")
        );
    }
    #[tokio::test]
    async fn backup_git_hidden_index_changes_are_refused() {
        let fixture = Fixture::new();
        let remote = fixture.configure().await;
        fixture.publish(&remote).await.unwrap();
        local_git(
            &fixture.root,
            &["update-index", "--assume-unchanged", FILES[0]],
        );
        fs::write(fixture.root.join(FILES[0]), "hidden user edit").unwrap();
        assert!(fixture.publish(&remote).await.is_err());
        assert_eq!(
            fs::read_to_string(fixture.root.join(FILES[0])).unwrap(),
            "hidden user edit"
        );
    }
    #[tokio::test]
    async fn backup_git_adoption_and_existing_clone() {
        let fixture = Fixture::new();
        let remote = fixture.configure().await;
        fixture.publish(&remote).await.unwrap();
        assert_eq!(
            fixture.configure().await.repository_id,
            remote.repository_id
        );
        let second = fixture.directory.join("second");
        configure(&fixture.tools, "owner/archive", &second)
            .await
            .unwrap();
        assert_eq!(
            fs::read(second.join(FILES[0])).unwrap(),
            fs::read(fixture.exports.join("data.json")).unwrap()
        );
        assert!(configure(&fixture.tools, "other/repo", &fixture.root)
            .await
            .is_err());
        let unrelated = fixture.directory.join("unrelated");
        fs::create_dir(&unrelated).unwrap();
        fs::write(unrelated.join("README.md"), "mine").unwrap();
        assert!(configure(&fixture.tools, "owner/archive", &unrelated)
            .await
            .is_err());
    }
    #[tokio::test]
    async fn backup_git_non_fast_forward_preserves_local_commit() {
        let fixture = Fixture::new();
        let remote = fixture.configure().await;
        fixture.publish(&remote).await.unwrap();
        let other = fixture.directory.join("other");
        local_git(
            &fixture.directory,
            &[
                "clone",
                fixture.bare.to_str().unwrap(),
                other.to_str().unwrap(),
            ],
        );
        fs::write(other.join(FILES[0]), "external").unwrap();
        local_git(&other, &["add", "--", FILES[0]]);
        local_git(
            &other,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "-m",
                "external",
            ],
        );
        local_git(&other, &["push", "origin", "HEAD:refs/heads/main"]);
        fs::write(fixture.exports.join("data.json"), "new local").unwrap();
        assert!(fixture.publish(&remote).await.is_err());
        assert_eq!(
            local_git(&fixture.root, &["show", "HEAD:export/data.json"]),
            "new local"
        );
        assert_eq!(
            local_git(&fixture.bare, &["show", "main:export/data.json"]),
            "external"
        );
    }
    async fn interrupted(fixture: &Fixture, remote: &RemoteConfig) -> Journal {
        let prior_head = head(&fixture.tools, &fixture.root).await.unwrap();
        let prior = tree(&fixture.tools, &fixture.root, prior_head.as_deref())
            .await
            .unwrap();
        fs::write(fixture.exports.join("data.json"), "changed portable data").unwrap();
        let mut bytes = BTreeMap::new();
        let mut target = BTreeMap::new();
        for path in FILES {
            let source = fixture.exports.join(Path::new(path).file_name().unwrap());
            target.insert(
                path.into(),
                hash(&fixture.tools, &fixture.root, &source).await.unwrap(),
            );
            bytes.insert(path.into(), fs::read(source).unwrap());
        }
        let journal = Journal {
            id: uuid::Uuid::new_v4().to_string(),
            repository_id: remote.repository_id.clone(),
            prior_head,
            prior,
            target,
            bytes,
        };
        atomic_private_write(
            &journal_path(&fixture.root).unwrap(),
            &serde_json::to_vec(&journal).unwrap(),
        )
        .unwrap();
        atomic_private_write(&fixture.root.join(FILES[0]), &journal.bytes[FILES[0]]).unwrap();
        local_git(&fixture.root, &["add", "--", FILES[0]]);
        journal
    }
    #[tokio::test]
    async fn backup_git_journal_resumes_partial_stage_and_committed_crash() {
        let fixture = Fixture::new();
        let remote = fixture.configure().await;
        fixture.publish(&remote).await.unwrap();
        let journal = interrupted(&fixture, &remote).await;
        fixture.publish(&remote).await.unwrap();
        assert!(!journal_path(&fixture.root).unwrap().exists());
        // Simulate a crash after commit but before journal removal.
        atomic_private_write(
            &journal_path(&fixture.root).unwrap(),
            &serde_json::to_vec(&journal).unwrap(),
        )
        .unwrap();
        fixture.publish(&remote).await.unwrap();
        assert_eq!(
            local_git(&fixture.root, &["rev-list", "--count", "HEAD"]),
            "2"
        );
    }
    #[tokio::test]
    async fn backup_git_corrupt_journal_preserves_worktree() {
        let fixture = Fixture::new();
        let remote = fixture.configure().await;
        fixture.publish(&remote).await.unwrap();
        let mut journal = interrupted(&fixture, &remote).await;
        let before = fs::read(fixture.root.join(FILES[0])).unwrap();
        journal.bytes.insert(FILES[0].into(), b"corrupted".to_vec());
        atomic_private_write(
            &journal_path(&fixture.root).unwrap(),
            &serde_json::to_vec(&journal).unwrap(),
        )
        .unwrap();
        assert!(fixture.publish(&remote).await.is_err());
        assert_eq!(fs::read(fixture.root.join(FILES[0])).unwrap(), before);
    }
    #[tokio::test]
    async fn backup_git_journal_refuses_unrelated_edits() {
        let fixture = Fixture::new();
        let remote = fixture.configure().await;
        fixture.publish(&remote).await.unwrap();
        interrupted(&fixture, &remote).await;
        fs::write(fixture.root.join(FILES[1]), "user edit SENTINEL_SECRET").unwrap();
        assert!(fixture.publish(&remote).await.is_err());
        assert_eq!(
            fs::read_to_string(fixture.root.join(FILES[1])).unwrap(),
            "user edit SENTINEL_SECRET"
        );
        assert!(journal_path(&fixture.root).unwrap().exists());
    }
    #[tokio::test]
    async fn backup_git_process_timeout_missing_tool_and_bounded_sanitized_output() {
        let fixture = Fixture::new();
        let mut tools = fixture.tools.clone();
        tools.timeout = Duration::from_millis(100);
        let slow = fixture.directory.join("slow");
        script(
            &slow,
            "#!/usr/bin/env python3\nimport time\ntime.sleep(10)\n",
        );
        assert!(tools
            .run(&slow, &[], None)
            .await
            .err()
            .unwrap()
            .to_string()
            .contains("timeout"));
        assert!(tools
            .run(&fixture.directory.join("missing"), &[], None)
            .await
            .is_err());
        let verbose = fixture.directory.join("verbose");
        script(
            &verbose,
            "#!/usr/bin/env python3\nprint('SENTINEL_SECRET' * 200000)\n",
        );
        tools.timeout = Duration::from_secs(5);
        let message = tools
            .run(&verbose, &[], None)
            .await
            .err()
            .unwrap()
            .to_string();
        assert!(message.contains("output_limit"));
        assert!(!message.contains("SENTINEL_SECRET"));
    }
}
