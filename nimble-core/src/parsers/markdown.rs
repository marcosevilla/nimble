use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CheckboxItem {
    pub line_number: usize,
    pub checked: bool,
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ParsedTodayMd {
    pub tasks: Vec<CheckboxItem>,
    pub habits_core: Vec<CheckboxItem>,
    pub habits_bonus: Vec<CheckboxItem>,
}

/// Parse today.md into structured sections.
pub fn parse_today_md(content: &str) -> ParsedTodayMd {
    let lines: Vec<&str> = content.lines().collect();
    let mut tasks = Vec::new();
    let mut habits_core = Vec::new();
    let mut habits_bonus = Vec::new();

    let mut section = Section::Preamble;
    let mut in_bonus = false;

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();

        if trimmed == "---" {
            if section == Section::Tasks {
                section = Section::AfterTasks;
            }
            continue;
        }
        if trimmed.starts_with("# Today") {
            section = Section::Tasks;
            continue;
        }
        if trimmed.starts_with("## Habits") {
            section = Section::Habits;
            in_bonus = false;
            continue;
        }

        if trimmed.starts_with("---") || trimmed.starts_with("*") || trimmed.is_empty() {
            if section == Section::Habits && trimmed.is_empty() && !habits_core.is_empty() {
                in_bonus = true;
            }
            continue;
        }

        if trimmed.contains("<details") || trimmed.contains("<summary") || trimmed.contains("</details>") || trimmed.contains("</summary>") {
            if trimmed.contains("Bonus") {
                in_bonus = true;
            }
            continue;
        }

        if let Some(item) = parse_checkbox_line(trimmed, i) {
            match section {
                Section::Tasks => tasks.push(item),
                Section::Habits => {
                    if in_bonus {
                        habits_bonus.push(item);
                    } else {
                        habits_core.push(item);
                    }
                }
                _ => {}
            }
        }
    }

    ParsedTodayMd {
        tasks,
        habits_core,
        habits_bonus,
    }
}

fn parse_checkbox_line(line: &str, line_number: usize) -> Option<CheckboxItem> {
    let trimmed = line.trim();
    if trimmed.starts_with("- [x]") || trimmed.starts_with("- [X]") {
        let text = trimmed[5..].trim().to_string();
        Some(CheckboxItem {
            line_number,
            checked: true,
            text,
        })
    } else if trimmed.starts_with("- [ ]") {
        let text = trimmed[5..].trim().to_string();
        Some(CheckboxItem {
            line_number,
            checked: false,
            text,
        })
    } else {
        None
    }
}

/// Toggle a checkbox at a specific line number in the file content.
pub fn toggle_checkbox(content: &str, line_number: usize) -> String {
    let mut lines: Vec<String> = content.lines().map(String::from).collect();

    if line_number < lines.len() {
        let line = &lines[line_number];
        if line.contains("- [ ]") {
            lines[line_number] = line.replace("- [ ]", "- [x]");
        } else if line.contains("- [x]") || line.contains("- [X]") {
            lines[line_number] = line.replace("- [x]", "- [ ]").replace("- [X]", "- [ ]");
        }
    }

    lines.join("\n")
}

#[derive(Debug, PartialEq)]
enum Section {
    Preamble,
    Tasks,
    AfterTasks,
    Habits,
}

/// Parse annual goals and daily habits from the resolutions file.
pub fn parse_resolutions(content: &str) -> (Vec<String>, Vec<(String, String)>) {
    let mut goals = Vec::new();
    let mut habits = Vec::new();

    let mut in_annual_goals = false;
    let mut current_habit_category: Option<String> = None;
    let mut in_daily_habits = false;

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with('#') {
            let header = trimmed.trim_start_matches('#').trim().to_lowercase()
                .replace("==", "").replace("*", "");

            if header.contains("annual") {
                in_annual_goals = true;
                in_daily_habits = false;
                current_habit_category = None;
                continue;
            }
            if header.contains("daily habits") || header.contains("daily") {
                in_annual_goals = false;
                in_daily_habits = true;
                current_habit_category = None;
                continue;
            }
            if header.contains("intentions") || header.contains("rules") || header.contains("monthly") {
                in_annual_goals = false;
                in_daily_habits = false;
                current_habit_category = None;
                continue;
            }
            continue;
        }

        if in_daily_habits {
            let stripped = trimmed.replace('*', "").to_lowercase();
            if stripped == "social" || stripped == "physical" || stripped == "digital" {
                current_habit_category = Some(
                    stripped.chars().next().unwrap().to_uppercase().to_string() + &stripped[1..],
                );
                continue;
            }
        }

        if in_annual_goals && trimmed.starts_with("- [") {
            if let Some(bracket_end) = trimmed.find(']') {
                let name = trimmed[bracket_end + 1..].trim();
                if !name.is_empty() {
                    goals.push(name.to_string());
                }
            }
        }

        if let Some(ref category) = current_habit_category {
            if trimmed.starts_with("- [") {
                if let Some(bracket_end) = trimmed.find(']') {
                    let name = trimmed[bracket_end + 1..].trim();
                    if !name.is_empty() {
                        habits.push((name.to_string(), category.clone()));
                    }
                }
            }
        }
    }

    (goals, habits)
}

/// Parse bingo card items from the bingo card file.
pub fn parse_bingo_card(content: &str) -> Vec<String> {
    let mut items = Vec::new();
    let mut in_progress = false;

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with('#') {
            let header = trimmed.trim_start_matches('#').trim().to_lowercase();
            if header.contains("progress") {
                in_progress = true;
                continue;
            }
            if in_progress && !header.is_empty() {
                break;
            }
        }

        if in_progress && trimmed.starts_with("- [") {
            if let Some(bracket_end) = trimmed.find(']') {
                let name = trimmed[bracket_end + 1..].trim();
                if !name.is_empty() {
                    items.push(name.to_string());
                }
            }
        }
    }

    items
}
