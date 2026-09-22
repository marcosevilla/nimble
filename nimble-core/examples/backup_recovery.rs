//! Offline recovery only. Never initializes application services.
use std::path::PathBuf;
fn parse(args: Vec<String>) -> Result<(String, PathBuf, PathBuf), &'static str> {
    if args.len() != 5
        || !matches!(args[0].as_str(), "snapshot" | "export")
        || args[1] != "--source"
        || args[3] != "--dest"
        || args[2].is_empty()
        || args[4].is_empty()
    {
        return Err(
            "Usage: backup_recovery <snapshot|export> --source <directory> --dest <new-directory>",
        );
    }
    Ok((
        args[0].clone(),
        PathBuf::from(&args[2]),
        PathBuf::from(&args[4]),
    ))
}
#[tokio::main]
async fn main() {
    let (route, source, dest) = match parse(std::env::args().skip(1).collect()) {
        Ok(args) => args,
        Err(usage) => {
            eprintln!("{usage}");
            std::process::exit(2);
        }
    };
    let result = if route == "snapshot" {
        nimble_core::db::recovery::restore_snapshot(&source, &dest).await
    } else {
        nimble_core::db::recovery::restore_export(&source, &dest).await
    };
    match result {
        Ok(report) => println!("{} verified={}", report.output.display(), report.verified),
        Err(_) => {
            eprintln!("Recovery failed; destination was not verified. Source remains unchanged.");
            std::process::exit(1);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_two_exact_forms() {
        for mode in ["snapshot", "export"] {
            let args = vec![
                mode,
                "--source",
                "/scratch/source",
                "--dest",
                "/scratch/new",
            ];
            assert!(parse(args.iter().map(|s| s.to_string()).collect()).is_ok());
            for n in 0..5 {
                assert!(parse(args[..n].iter().map(|s| s.to_string()).collect()).is_err());
            }
            let mut extra: Vec<String> = args.iter().map(|s| s.to_string()).collect();
            extra.push("--live".into());
            assert!(parse(extra).is_err());
        }
    }
}
