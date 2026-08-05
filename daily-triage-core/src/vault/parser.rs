use turbovault_parser::ParsedContent;

/// A link extracted from a note, normalised for the index: the `#heading` /
/// `#^block` fragment is stripped so `to_path` can be matched against
/// `vault_notes.path` (or a note title) during resolution.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ParsedLink {
    pub to_path: String,
    /// `"wikilink"` or `"embed"`.
    pub link_type: String,
}

#[derive(Debug, Clone, Default)]
pub struct ParsedNote {
    pub title: String,
    pub frontmatter_json: Option<String>,
    pub links: Vec<ParsedLink>,
    pub tags: Vec<String>,
}

/// Filename stem as a human title: `journal/Brief 2026-08-04.md` → `Brief 2026-08-04`.
pub fn title_from_path(rel_path: &str) -> String {
    rel_path
        .rsplit('/')
        .next()
        .unwrap_or(rel_path)
        .trim_end_matches(".md")
        .trim_end_matches(".MD")
        .to_string()
}

/// Parse one note's raw markdown into the fields the index stores.
///
/// Title precedence: frontmatter `title` → first H1 → filename stem.
/// Never fails: a note that parses to nothing still yields a filename title.
pub fn parse_note(rel_path: &str, content: &str) -> ParsedNote {
    let parsed = ParsedContent::parse(content);

    // `fm.data` is a `HashMap`, whose iteration order is randomized per
    // process — serializing it directly would give the same note a different
    // `frontmatter_json` string on every app restart, and a different one on
    // each device. Collect into a `BTreeMap` first so the column is stable and
    // comparable.
    let frontmatter_json = parsed.frontmatter.as_ref().and_then(|fm| {
        let ordered: std::collections::BTreeMap<&String, &serde_json::Value> =
            fm.data.iter().collect();
        serde_json::to_string(&ordered).ok()
    });

    let title = parsed
        .frontmatter
        .as_ref()
        .and_then(|fm| fm.data.get("title"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            parsed
                .headings
                .iter()
                .find(|h| h.level == 1)
                .map(|h| h.text.trim().to_string())
                .filter(|s| !s.is_empty())
        })
        .unwrap_or_else(|| title_from_path(rel_path));

    let mut links: Vec<ParsedLink> = Vec::new();
    let push_link = |target: &str, link_type: &str, links: &mut Vec<ParsedLink>| {
        // Strip the `#heading` / `#^block` fragment; a target that is *only* a
        // fragment is a same-document anchor and not a link between notes.
        let to_path = target.split('#').next().unwrap_or("").trim().to_string();
        if to_path.is_empty() {
            return;
        }
        let candidate = ParsedLink { to_path, link_type: link_type.to_string() };
        if !links.contains(&candidate) {
            links.push(candidate);
        }
    };
    for link in &parsed.wikilinks {
        push_link(&link.target, "wikilink", &mut links);
    }
    for embed in &parsed.embeds {
        push_link(&embed.target, "embed", &mut links);
    }

    let mut tags: Vec<String> = Vec::new();
    for tag in &parsed.tags {
        let name = tag.name.trim_start_matches('#').trim().to_string();
        if !name.is_empty() && !tags.contains(&name) {
            tags.push(name);
        }
    }
    if let Some(fm) = parsed.frontmatter.as_ref() {
        for name in fm.tags() {
            let name = name.trim_start_matches('#').trim().to_string();
            if !name.is_empty() && !tags.contains(&name) {
                tags.push(name);
            }
        }
    }

    ParsedNote { title, frontmatter_json, links, tags }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOTE: &str = "---\ntitle: My Real Title\ntags: [alpha, beta]\n---\n\n# Ignored Heading\n\nSee [[Other Note#Section|alias]] and ![[attachments/img.png]] plus [[Other Note]] again.\n\nTagged #rust and #project/obsidian.\n";

    #[test]
    fn title_prefers_frontmatter_then_h1_then_filename() {
        assert_eq!(parse_note("a/b.md", NOTE).title, "My Real Title");

        let h1_only = "# Heading Wins\n\nbody";
        assert_eq!(parse_note("a/b.md", h1_only).title, "Heading Wins");

        let bare = "just body text";
        assert_eq!(parse_note("journal/Brief 2026-08-04.md", bare).title, "Brief 2026-08-04");
    }

    #[test]
    fn links_drop_fragments_dedupe_and_keep_type() {
        let parsed = parse_note("a/b.md", NOTE);
        assert_eq!(
            parsed.links,
            vec![
                ParsedLink { to_path: "Other Note".into(), link_type: "wikilink".into() },
                ParsedLink { to_path: "attachments/img.png".into(), link_type: "embed".into() },
            ]
        );
    }

    #[test]
    fn same_document_anchors_are_not_links() {
        let parsed = parse_note("a/b.md", "See [[#^block123]] and [[#Section]].");
        assert!(parsed.links.is_empty(), "got {:?}", parsed.links);
    }

    #[test]
    fn tags_merge_inline_and_frontmatter_without_duplicates() {
        let mut tags = parse_note("a/b.md", NOTE).tags;
        tags.sort();
        assert_eq!(tags, vec!["alpha", "beta", "project/obsidian", "rust"]);

        let dupes = parse_note("a/b.md", "---\ntags: [rust]\n---\n\n#rust #rust\n");
        assert_eq!(dupes.tags, vec!["rust"]);
    }

    #[test]
    fn frontmatter_json_round_trips_or_is_none() {
        let parsed = parse_note("a/b.md", NOTE);
        let json = parsed.frontmatter_json.expect("frontmatter json");
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["title"], "My Real Title");

        assert!(parse_note("a/b.md", "no frontmatter here").frontmatter_json.is_none());
    }

    #[test]
    fn frontmatter_json_key_order_is_stable() {
        // The upstream frontmatter map is a HashMap; without an explicit
        // ordering the same note would serialize differently run to run.
        let wide = "---\nzeta: 1\nalpha: 2\nmiddle: 3\ntitle: T\ntags: [x]\n---\n\nbody\n";
        let first = parse_note("a/b.md", wide).frontmatter_json.expect("json");
        for _ in 0..8 {
            assert_eq!(parse_note("a/b.md", wide).frontmatter_json.as_deref(), Some(first.as_str()));
        }
        assert!(first.starts_with(r#"{"alpha":"#), "keys should be sorted: {first}");
    }

    #[test]
    fn blank_title_levels_fall_through() {
        // Requirement: an empty or whitespace-only value at one precedence
        // level falls through to the next.
        let blank_fm = "---\ntitle: \"   \"\n---\n\n# H1 Wins\n\nbody";
        assert_eq!(parse_note("a/b.md", blank_fm).title, "H1 Wins");

        let blank_both = "---\ntitle: \"\"\n---\n\n#    \n\nbody";
        assert_eq!(parse_note("journal/Fallback Name.md", blank_both).title, "Fallback Name");
    }
}
