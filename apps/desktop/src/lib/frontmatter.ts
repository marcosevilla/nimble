/* Pure splitter for a note's leading YAML frontmatter (docs audit P2-2).
   The vault view renders the fields as a chip row and hands only the body
   to the editor, so metadata never becomes the note's boldest heading.

   Deliberately tiny: `key: value` scalars, inline `[a, b]` lists and
   `- item` block lists. Anything else is kept as its raw text. No YAML
   dependency — the chips are display-only and nothing is written back.

   Tested by tests/frontmatter.test.mjs (plain TS, no JSX). */

export interface FrontmatterField {
  key: string
  value: string
}

export interface SplitNote {
  fields: FrontmatterField[]
  body: string
}

const FENCE = /^\uFEFF?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/

export function splitFrontmatter(content: string): SplitNote {
  const match = FENCE.exec(content)
  if (!match) return { fields: [], body: content }

  const fields: FrontmatterField[] = []
  for (const rawLine of (match[1] ?? '').split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '')
    if (!line.trim()) continue

    const item = /^\s+-\s+(.*)$/.exec(line)
    if (item && fields.length > 0) {
      const last = fields[fields.length - 1]
      last.value = last.value ? `${last.value}, ${cleanScalar(item[1])}` : cleanScalar(item[1])
      continue
    }

    const kv = /^([^\s:][^:]*?)\s*:\s*(.*)$/.exec(line)
    if (!kv) continue
    fields.push({ key: kv[1].trim(), value: cleanValue(kv[2]) })
  }

  return { fields, body: content.slice(match[0].length) }
}

function cleanValue(raw: string): string {
  const v = raw.trim()
  const inline = /^\[(.*)\]$/.exec(v)
  if (inline) {
    return inline[1]
      .split(',')
      .map((s) => cleanScalar(s))
      .filter(Boolean)
      .join(', ')
  }
  return cleanScalar(v)
}

function cleanScalar(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, '')
}
