// Parse the daily brief markdown into sections. The brief generator lives
// outside this repo, so the no-guilt copy rule (CLAUDE.md: no "overdue"
// labels, use "still open") is enforced here in the display layer.

export interface BriefSection {
  title: string
  content: string
}

/** Vault heading → what Nimble shows. Keys are matched after emoji stripping. */
const SECTION_DISPLAY: Record<string, string> = {
  'Overdue Check-in': 'Still open',
}

// A leading pictograph (with optional variation selector / ZWJ sequence
// parts) followed by whitespace, e.g. "⏰ Admin Deadlines" or "🎯 Work".
const LEADING_EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:️|‍(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}))*\s+/u

/** Normalise a raw `## ` heading: strip a leading emoji, then apply the display map. */
export function displaySectionTitle(raw: string): string {
  const stripped = raw.replace(LEADING_EMOJI, '').trim()
  return SECTION_DISPLAY[stripped] ?? stripped
}

// Sections that start expanded, keyed on the normalised (display) title.
const DEFAULT_OPEN = new Set([
  'Before You Start',
  'Core Habits',
  "Today's Shape",
  'Work',
  'Personal',
])

export function isOpenByDefault(title: string): boolean {
  return DEFAULT_OPEN.has(title)
}

export function parseBrief(markdown: string): { title: string; sections: BriefSection[] } {
  // Strip YAML frontmatter
  const fmMatch = markdown.match(/^---\n[\s\S]*?\n---\n/)
  const body = fmMatch ? markdown.slice(fmMatch[0].length) : markdown

  // Extract h1 title
  const h1Match = body.match(/^# (.+)$/m)
  const title = h1Match ? h1Match[1] : ''

  // Split by ## headings
  const sections: BriefSection[] = []
  const parts = body.split(/^## /m).slice(1) // skip content before first ##

  for (const part of parts) {
    const newlineIdx = part.indexOf('\n')
    if (newlineIdx === -1) continue
    const sectionTitle = displaySectionTitle(part.slice(0, newlineIdx))
    const content = part.slice(newlineIdx + 1).trim()
    if (sectionTitle) sections.push({ title: sectionTitle, content })
  }

  return { title, sections }
}
