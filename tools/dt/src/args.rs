use clap::{Args, Parser, Subcommand};
use std::path::PathBuf;
#[derive(Parser, Debug)]
#[command(
    name = "dt",
    version,
    about = "Local Nimble task access. Writes are never automatically retried."
)]
pub struct Cli {
    #[arg(long, global = true)]
    pub json: bool,
    /// Marked synthetic profile in the OS temporary directory; never creates a database.
    #[arg(long, global = true)]
    pub profile: Option<PathBuf>,
    #[command(subcommand)]
    pub command: Command,
}
#[derive(Subcommand, Debug)]
pub enum Command {
    #[command(subcommand)]
    Task(Task),
    #[command(subcommand)]
    Project(Project),
    #[command(subcommand)]
    Section(Section),
    #[command(subcommand)]
    Label(Label),
    #[command(subcommand)]
    Capture(Capture),
    #[command(subcommand)]
    Activity(Activity),
    #[command(subcommand)]
    Backup(Backup),
    #[command(subcommand)]
    Sync(Sync),
    Gap(Gap),
}
#[derive(Args, Debug, Default)]
pub struct Fields {
    #[arg(long)]
    pub project: Option<String>,
    #[arg(long)]
    pub description: Option<String>,
    #[arg(long,value_parser=clap::value_parser!(i64).range(1..=4))]
    pub priority: Option<i64>,
    #[arg(long, conflicts_with = "clear_due_date")]
    pub due: Option<String>,
    #[arg(long, conflicts_with = "clear_due_time")]
    pub time: Option<String>,
    #[arg(long,value_parser=clap::value_parser!(i64).range(1..),conflicts_with="clear_duration")]
    pub duration: Option<i64>,
    #[arg(long, conflicts_with = "clear_recurrence")]
    pub recurrence: Option<String>,
    #[arg(long, conflicts_with = "clear_section")]
    pub section: Option<String>,
    #[arg(long, value_delimiter = ',', conflicts_with = "clear_labels")]
    pub labels: Option<Vec<String>>,
    #[arg(long)]
    pub clear_labels: bool,
    #[arg(long)]
    pub clear_due_date: bool,
    #[arg(long)]
    pub clear_due_time: bool,
    #[arg(long)]
    pub clear_duration: bool,
    #[arg(long)]
    pub clear_recurrence: bool,
    #[arg(long)]
    pub clear_section: bool,
    #[arg(long,value_parser=clap::value_parser!(i64).range(0..),conflicts_with="clear_reminder")]
    pub reminder_offset: Option<i64>,
    #[arg(long)]
    pub clear_reminder: bool,
    #[arg(long,action=clap::ArgAction::Set)]
    pub google_calendar_enabled: Option<bool>,
}
#[derive(Subcommand, Debug)]
pub enum Task {
    List {
        #[arg(long)]
        project: Option<String>,
        #[arg(long)]
        due: Option<String>,
        #[arg(long)]
        include_completed: bool,
    },
    Get {
        id: String,
    },
    Create {
        content: String,
        #[arg(long)]
        parent: Option<String>,
        #[command(flatten)]
        fields: Fields,
    },
    Update {
        id: String,
        #[arg(long)]
        content: Option<String>,
        #[arg(long)]
        linked_doc: Option<String>,
        #[command(flatten)]
        fields: Fields,
    },
    Complete {
        id: String,
    },
    Reopen {
        id: String,
    },
    Status {
        id: String,
        #[arg(value_parser=["backlog","todo","in_progress","blocked","complete"])]
        status: String,
        #[arg(long)]
        reason: Option<String>,
    },
    Delete {
        id: String,
    },
    Labels {
        id: String,
        #[arg(
            long,
            value_delimiter = ',',
            required_unless_present = "clear",
            conflicts_with = "clear"
        )]
        ids: Vec<String>,
        #[arg(long)]
        clear: bool,
    },
}
#[derive(Subcommand, Debug)]
pub enum Project {
    List,
    Create {
        name: String,
        #[arg(long, default_value = "gray")]
        color: String,
        #[arg(long)]
        parent: Option<String>,
    },
    Update {
        id: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        color: Option<String>,
        #[arg(long, conflicts_with = "clear_parent")]
        parent: Option<String>,
        #[arg(long)]
        clear_parent: bool,
    },
    Delete {
        id: String,
    },
}
#[derive(Subcommand, Debug)]
pub enum Section {
    List {
        #[arg(long)]
        project: String,
    },
    Create {
        name: String,
        #[arg(long)]
        project: String,
    },
    Rename {
        id: String,
        name: String,
    },
    Delete {
        id: String,
    },
    Reorder {
        #[arg(long, value_delimiter = ',', required = true)]
        ids: Vec<String>,
    },
}
#[derive(Subcommand, Debug)]
pub enum Label {
    List,
    Create {
        name: String,
        #[arg(long, default_value = "gray")]
        color: String,
    },
    Update {
        id: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        color: Option<String>,
    },
    Delete {
        id: String,
    },
}
#[derive(Subcommand, Debug)]
pub enum Capture {
    List {
        #[arg(long,default_value_t=100,value_parser=clap::value_parser!(i64).range(1..=10000))]
        limit: i64,
        #[arg(long)]
        include_converted: bool,
    },
    Create {
        content: String,
        #[arg(long)]
        context: Option<String>,
    },
    Delete {
        id: String,
    },
}
#[derive(Args, Debug)]
pub struct DateRange {
    #[arg(long)]
    pub from: String,
    #[arg(long)]
    pub to: String,
}
#[derive(Subcommand, Debug)]
pub enum Activity {
    List {
        #[command(flatten)]
        dates: DateRange,
        #[arg(long)]
        action: Option<String>,
        #[arg(long)]
        target: Option<String>,
        #[arg(long,default_value_t=100,value_parser=clap::value_parser!(i64).range(1..=10000))]
        limit: i64,
    },
    Summary {
        #[arg(long)]
        date: String,
    },
}
#[derive(Subcommand, Debug)]
pub enum Backup {
    Status,
    Now,
    Verify,
}
#[derive(Subcommand, Debug)]
pub enum Sync {
    Status,
    Now,
}
#[derive(Args, Debug)]
pub struct Gap {
    pub reason: Option<String>,
    #[command(subcommand)]
    pub command: Option<GapCommand>,
}
#[derive(Subcommand, Debug)]
pub enum GapCommand {
    List {
        #[command(flatten)]
        dates: DateRange,
    },
}
