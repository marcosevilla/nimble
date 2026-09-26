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
    /// Retry identity for a task write handled by the running app. After an
    /// uncertain result, repeat the exact command with the SAME value.
    #[arg(long, global = true)]
    pub command_id: Option<String>,
    #[command(subcommand)]
    pub command: Command,
}
#[derive(Subcommand, Debug, Clone)]
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
    #[command(subcommand)]
    Momentum(Momentum),
    #[command(subcommand)]
    Todoist(Todoist),
}
#[derive(Args, Debug, Default, Clone)]
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
#[derive(Subcommand, Debug, Clone)]
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
        /// Due date the task had when you decided to complete it
        /// (YYYY-MM-DD, or "none"). Defaults to the current value.
        #[arg(long)]
        expected_due: Option<String>,
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
        /// For status "complete": see `task complete --expected-due`.
        #[arg(long)]
        expected_due: Option<String>,
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
    /// Full-text search over titles and descriptions: open tasks first,
    /// completed included. Reads this Mac's device-local index.
    Search {
        query: Option<String>,
        #[arg(long, value_parser = ["all", "open", "completed"], default_value = "all")]
        status: String,
        /// Label name or id; repeat for any-of.
        #[arg(long)]
        label: Vec<String>,
        /// Project name or id.
        #[arg(long)]
        project: Option<String>,
        #[arg(long, default_value_t = 50, value_parser = clap::value_parser!(i64).range(1..=200))]
        limit: i64,
        /// Rebuild the search index first (alone, when no query is given).
        #[arg(long)]
        reindex: bool,
    },
}
#[derive(Subcommand, Debug, Clone)]
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
#[derive(Subcommand, Debug, Clone)]
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
#[derive(Subcommand, Debug, Clone)]
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
    /// Ungrouped, visible labels with no open task (what `archive --unused`
    /// archives). Grouped and system labels are never listed.
    Unused,
    #[command(subcommand)]
    Group(LabelGroupCommand),
    /// Archive labels (name or id), or every unused label.
    Archive {
        #[arg(required_unless_present = "unused", conflicts_with = "unused")]
        labels: Vec<String>,
        #[arg(long)]
        unused: bool,
    },
    /// Restore archived labels (name or id).
    Restore {
        #[arg(required = true)]
        labels: Vec<String>,
    },
}
#[derive(Subcommand, Debug, Clone)]
pub enum LabelGroupCommand {
    List,
    /// Create a group, or reuse the one with this name (case-insensitive).
    Create {
        name: String,
        /// "Pick one": at most one of this group's labels per task (UI-enforced).
        #[arg(long)]
        pick_one: bool,
        /// Integration group: its labels are hidden from pickers and row chips.
        #[arg(long)]
        system: bool,
    },
    /// Put a label (name or id) into a group (name or id).
    Assign { label: String, group: String },
}
#[derive(Subcommand, Debug, Clone)]
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
#[derive(Args, Debug, Clone)]
pub struct DateRange {
    #[arg(long)]
    pub from: String,
    #[arg(long)]
    pub to: String,
}
#[derive(Subcommand, Debug, Clone)]
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
#[derive(Subcommand, Debug, Clone)]
pub enum Backup {
    Status,
    Now,
    Verify,
    /// Explicitly activate a restored profile on this Mac (running app only).
    Activate,
}
#[derive(Subcommand, Debug, Clone)]
pub enum Sync {
    Status,
    Now,
    /// One-time Todoist reconcile. Without --apply: fetch, look up and report
    /// only (nothing written). With --apply: back up through the running app,
    /// then apply the plan in one transaction and run a full pull.
    Reconcile {
        #[arg(long)]
        apply: bool,
    },
}
#[derive(Args, Debug, Clone)]
pub struct Gap {
    pub reason: Option<String>,
    #[command(subcommand)]
    pub command: Option<GapCommand>,
}
#[derive(Subcommand, Debug, Clone)]
pub enum GapCommand {
    List {
        #[command(flatten)]
        dates: DateRange,
    },
}
#[derive(Subcommand, Debug, Clone)]
pub enum Momentum {
    /// Rebuild the momentum ledger from completed tasks and repeat history.
    /// Safe to rerun (e.g. after an import): existing rows are kept.
    Backfill,
    /// The numbers behind Today's Momentum box and the Activity tiles.
    Summary {
        #[arg(long, default_value = "7d", value_parser = ["7d", "30d", "all"])]
        range: String,
    },
}
#[derive(Subcommand, Debug, Clone)]
pub enum Todoist {
    /// Import completed Todoist tasks into Nimble (default: the last 12
    /// months). Without --apply: fetch and report only (nothing written).
    /// With --apply: back up through the running app, then import in one
    /// transaction; re-running imports nothing new. Reads Todoist only.
    ImportHistory {
        #[arg(long, default_value_t = 12, value_parser = clap::value_parser!(u32).range(1..=120))]
        since_months: u32,
        #[arg(long)]
        apply: bool,
        /// Also write EVERY completed task ever, plus projects (archived
        /// too), sections and labels, as raw Todoist JSON to
        /// <DIR>/todoist-completed-archive-YYYY-MM-DD.json (0600, never
        /// overwritten). The archive never writes to the database.
        #[arg(long, value_name = "DIR")]
        archive: Option<PathBuf>,
    },
}
