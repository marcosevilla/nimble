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
        Ok(value) => {
            if json_mode {
                println!("{value}")
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
async fn run(cli: args::Cli) -> Result<serde_json::Value, output::CliError> {
    let open = profile::open(cli.profile.as_deref()).await?;
    if let Some(operation) = commands::app_operation(&cli.command) {
        let data = ipc::request(&open.profile, operation).await?;
        open.pool.close().await;
        return Ok(output::success(data, "not_required"));
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
                return Ok(output::success(data, "acknowledged"));
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
    Ok(output::success(result.data, refresh))
}
