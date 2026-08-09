/// Tags Tiptap's configured extensions can produce (StarterKit h1-3 + link + mention).
/// Anything else in a doc is flagged in the dry-run report as potentially lossy.
const KNOWN_TAGS: &[&str] = &[
    "p", "h1", "h2", "h3", "ul", "ol", "li", "strong", "b", "em", "i", "s",
    "code", "pre", "blockquote", "a", "br", "hr", "span",
];

/// Convert Tiptap HTML to markdown. Non-HTML input (doesn't start with '<')
/// and conversion failures return the input unchanged — never destroy content.
pub fn html_to_markdown(html: &str) -> String {
    if !html.trim_start().starts_with('<') {
        return html.to_string();
    }
    htmd::convert(html).unwrap_or_else(|_| html.to_string())
}

/// Distinct lowercase tag names present in `html` that are NOT in KNOWN_TAGS.
/// Hand-rolled scan (no regex dep): a tag is '<' + optional '/' + ascii-alpha run.
pub fn scan_unknown_tags(html: &str) -> Vec<String> {
    let bytes = html.as_bytes();
    let mut found: Vec<String> = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'<' {
            let mut j = i + 1;
            if j < bytes.len() && bytes[j] == b'/' {
                j += 1;
            }
            let start = j;
            while j < bytes.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'-') {
                j += 1;
            }
            // must look like a real tag: name followed by '>', ' ', '/' or attribute
            if j > start && j < bytes.len() && (bytes[j] == b'>' || bytes[j] == b' ' || bytes[j] == b'/') {
                let name = html[start..j].to_ascii_lowercase();
                if !KNOWN_TAGS.contains(&name.as_str()) && !found.contains(&name) {
                    found.push(name);
                }
            }
            i = j;
        } else {
            i += 1;
        }
    }
    found.sort();
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_representative_tiptap_structures() {
        let html = "<h1>Title</h1><p>Some <strong>bold</strong> and <em>italic</em> text.</p>\
                    <ul><li><p>item one</p></li><li><p>item two</p></li></ul>\
                    <blockquote><p>quoted</p></blockquote>\
                    <p><a href=\"https://example.com\">a link</a></p>\
                    <pre><code>let x = 1;</code></pre>";
        let md = html_to_markdown(html);
        assert!(md.contains("# Title"));
        assert!(md.contains("**bold**"));
        assert!(md.contains("*italic*") || md.contains("_italic_"));
        assert!(md.contains("item one"));
        assert!(md.contains("> quoted"));
        assert!(md.contains("[a link](https://example.com)"));
        assert!(md.contains("let x = 1;"));
        assert!(!md.contains('<'), "no HTML tags may survive: {md}");
    }

    #[test]
    fn plain_text_passes_through_untouched() {
        assert_eq!(html_to_markdown("already markdown # not html"), "already markdown # not html");
        assert_eq!(html_to_markdown(""), "");
    }

    #[test]
    fn mention_spans_keep_their_text() {
        let html = "<p>ping <span class=\"mention-tag\" data-id=\"marco\">@marco</span> today</p>";
        let md = html_to_markdown(html);
        assert!(md.contains("@marco"));
        assert!(!md.contains("<span"));
    }

    #[test]
    fn scanner_flags_tags_outside_allowlist() {
        let html = "<p>fine</p><table><tr><td>cell</td></tr></table><u>underline</u>";
        let tags = scan_unknown_tags(html);
        assert!(tags.contains(&"table".to_string()));
        assert!(tags.contains(&"u".to_string()));
        assert!(!tags.contains(&"p".to_string()));
    }

    #[test]
    fn scanner_ignores_plain_text() {
        assert!(scan_unknown_tags("a < b and c > d, no tags").is_empty());
    }
}
