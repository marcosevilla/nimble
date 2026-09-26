mod args;
mod commands;
mod ipc;
mod output;
mod profile;
use clap::Parser;
use serde_json::json;
#[tokio::main]
async fn main() {
    let args: Vec<_> = std::env::args_os().collect();
    let json_mode = args.iter().any(|s| s == "--json");
    let cli = match args::Cli::try_parse_from(args) {
        Ok(c) => c,
        Err(e) => {
            let help = matches!(
                e.kind(),
                clap::error::ErrorKind::DisplayHelp | clap::error::ErrorKind::DisplayVersion
            );
            if json_mode {
                let value = if help {
                    output::success(json!({"help":e.to_string()}), "not_required")
                } else {
                    output::failure(&output::CliError::validation(
                        "Invalid arguments. Use dt --json --help for usage.",
                    ))
                };
                println!("{value}");
            } else {
                let _ = e.print();
            }
            std::process::exit(if help { 0 } else { 2 });
        }
    };
    match run(cli).await {
        Ok((value, text)) => {
            if json_mode {
                println!("{value}")
            } else if let Some(text) = text {
                print!("{text}");
            } else {
                println!("{}", serde_json::to_string_pretty(&value).unwrap());
            }
        }
        Err(error) => {
            if json_mode {
                println!("{}", output::failure(&error));
            } else {
                eprintln!("{}", error.message);
            }
            std::process::exit(if error.code == "validation" { 2 } else { 1 });
        }
    }
}
/// The output envelope, plus human-readable text for commands that have one.
async fn run(cli: args::Cli) -> Result<(serde_json::Value, Option<String>), output::CliError> {
    let open = profile::open(cli.profile.as_deref()).await?;
    if let args::Command::Sync(args::Sync::Reconcile { apply }) = &cli.command {
        let outcome = commands::reconcile(&open.pool, &open.profile, *apply, !cli.json).await;
        open.pool.close().await;
        let (data, text) = outcome?;
        return Ok((output::success(data, "not_required"), Some(text)));
    }
    if let args::Command::Todoist(args::Todoist::ImportHistory { since_months, apply, archive }) = &cli.command {
        let outcome =
            commands::import_history(&open.pool, &open.profile, *since_months, *apply, archive.clone()).await;
        open.pool.close().await;
        let (data, text) = outcome?;
        return Ok((output::success(data, "not_required"), Some(text)));
    }
    if let Some(operation) = commands::app_operation(&cli.command) {
        let data = ipc::request(&open.profile, operation).await?;
        open.pool.close().await;
        return Ok((output::success(data, "not_required"), None));
    }
    // App-handled task writes: route through the running app's FocusService
    // with one retry identity. Only a definitely-absent app permits the direct
    // database path, and never for a retry of an earlier uncertain attempt.
    if let Some(write) = commands::native_write(&open.pool, cli.command.clone()).await? {
        let retry = cli.command_id.is_some();
        let command_id = cli.command_id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        if uuid::Uuid::parse_str(&command_id).is_err() {
            return Err(output::CliError::validation("--command-id must be a UUID."));
        }
        let command = nimble_core::db::focus::engine::NativeTaskCommand {
            command_id: command_id.clone(),
            action: write.action.clone(),
        };
        match ipc::native_task(&open.profile, command).await {
            Ok(data) => {
                let data = commands::native_output(&open.pool, &write, data).await?;
                open.pool.close().await;
                return Ok((output::success(data, "acknowledged"), None));
            }
            // The app holds this profile (process/profile lock) but its
            // listener is unreachable: it may be timing live, so writing
            // around it would bypass the one focus writer.
            Err(ipc::NativeFailure::AppNotRunning)
                if nimble_core::agent_protocol::ProfileOwnerLock::is_held(&open.profile.database)
                    .unwrap_or(true) =>
            {
                return Err(output::CliError::new(
                    "app_unreachable",
                    "Nimble is running with this profile but its assistant listener is unavailable. Nothing was written. Quit and reopen Nimble, then repeat the command.",
                ))
            }
            Err(ipc::NativeFailure::AppNotRunning) if !retry => {}
            Err(ipc::NativeFailure::AppNotRunning) => {
                return Err(output::CliError::new(
                    "app_required",
                    format!("Retry {command_id} must be sent to the running Nimble app that may have applied it. Open Nimble and repeat the same command."),
                ))
            }
            Err(ipc::NativeFailure::NotSent(e)) => return Err(e),
            Err(ipc::NativeFailure::Rejected { code, message }) => {
                return Err(output::CliError::new(code, message))
            }
            Err(ipc::NativeFailure::Uncertain) => {
                return Err(output::CliError::new(
                    "uncertain",
                    format!(
                        "Nimble did not confirm this write; it may have been applied. Check the task, and if you retry, repeat the same command with --command-id {command_id}{}.",
                        write.retry_flags
                    ),
                ))
            }
        }
    }
    let result = commands::execute(&open.pool, cli.command).await?;
    let refresh = ipc::notify(&open.profile, &result).await;
    open.pool.close().await;
    Ok((output::success(result.data, refresh), None))
}
