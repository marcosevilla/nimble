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
    let result = commands::execute(&open.pool, cli.command).await?;
    let refresh = ipc::notify(&open.profile, &result).await;
    open.pool.close().await;
    Ok(output::success(result.data, refresh))
}
