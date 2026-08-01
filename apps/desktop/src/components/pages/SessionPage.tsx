import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useDataProvider } from '@/services/provider-context'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ActivityTimeline } from '@/components/activity/ActivityTimeline'
import { PageHeader } from '@/components/shared/PageHeader'

// ── Lightweight inline-markdown renderer ──
//
// The session log is markdown on disk. We don't want to render full markdown
// (no headings/lists/code blocks inside a bullet), but we DO want to strip
// the `**`/`*`/backticks/brackets so bullets read like prose. Handles:
//
//   **bold**            → <strong>bold</strong>
//   *italic*            → <em>italic</em>
//   `code`              → <code>code</code>
//   [label](url)        → <a href="url">label</a>
//   [[Wiki link]]       → <span>Wiki link</span>  (no actual link — Obsidian-only)

const INLINE_MD_REGEX = /(\*\*[^*\n]+?\*\*)|(`[^`\n]+?`)|(\[\[[^\]\n]+?\]\])|(\[([^\]\n]+?)\]\(([^)\n]+?)\))|(\*[^*\n]+?\*)/g

function renderInline(text: string): ReactNode {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let key = 0
  for (const match of text.matchAll(INLINE_MD_REGEX)) {
    const [full, bold, code, wiki, mdlink, linkText, linkUrl, italic] = match
    const idx = match.index ?? 0
    if (idx > lastIndex) parts.push(text.slice(lastIndex, idx))
    if (bold) {
      parts.push(<strong key={key++} className="font-semibold">{bold.slice(2, -2)}</strong>)
    } else if (code) {
      parts.push(
        <code key={key++} className="rounded bg-muted/60 px-1 py-0.5 text-label font-mono">
          {code.slice(1, -1)}
        </code>,
      )
    } else if (wiki) {
      parts.push(<span key={key++} className="text-accent-blue">{wiki.slice(2, -2)}</span>)
    } else if (mdlink) {
      parts.push(
        <a
          key={key++}
          href={linkUrl}
          target="_blank"
          rel="noreferrer"
          className="text-accent-blue hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {linkText}
        </a>,
      )
    } else if (italic) {
      parts.push(<em key={key++}>{italic.slice(1, -1)}</em>)
    }
    lastIndex = idx + full.length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

// ── Session log parsing (unchanged) ──

interface SessionEntry {
  timeRange: string
  title: string
  tags: string[]
  bullets: string[]
  energy: string | null
  refs: string | null
}

function parseSessionLog(content: string): SessionEntry[] {
  const entries: SessionEntry[] = []
  const blocks = content.split(/\n---\n/).filter((b) => b.trim())

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    const headingIdx = lines.findIndex((l) => l.startsWith('## '))
    if (headingIdx === -1) continue

    const heading = lines[headingIdx].replace('## ', '')
    const dashMatch = heading.match(/^(.+?)\s*[—–-]\s*(.+)$/)
    const timeRange = dashMatch ? dashMatch[1].trim() : ''
    const title = dashMatch ? dashMatch[2].trim() : heading.trim()

    const tagLine = lines.find((l) => l.includes('`#'))
    const tags = tagLine
      ? [...tagLine.matchAll(/`#([^`]+)`/g)].map((m) => m[1])
      : []

    const bullets = lines
      .filter((l) => l.startsWith('- '))
      .map((l) => l.replace(/^- /, ''))

    const energyLine = lines.find((l) => l.includes('[!energy]'))
    const energy = energyLine
      ? energyLine.replace(/.*\[!energy\]\s*/, '').replace('Energy: ', '')
      : null

    const refsLine = lines.find((l) => l.startsWith('Refs:'))
    const refs = refsLine || null

    if (title || bullets.length > 0) {
      entries.push({ timeRange, title, tags, bullets, energy, refs })
    }
  }

  return entries
}

// ── Session card ──

function SessionCard({ entry }: { entry: SessionEntry }) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="rounded-lg border bg-card p-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-3 text-left"
      >
        <span
          className={cn(
            'mt-1 text-label text-muted-foreground transition-transform',
            expanded && 'rotate-90',
          )}
        >
          ▶
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-body-strong">{entry.title}</h3>
          {entry.timeRange && (
            <p className="text-label text-muted-foreground mt-0.5">
              {entry.timeRange}
            </p>
          )}
        </div>
        {entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 shrink-0">
            {entry.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full bg-accent/50 px-2 py-0.5 text-label text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </button>

      {expanded && entry.bullets.length > 0 && (
        <div className="ml-6 mt-3 space-y-1.5">
          {entry.bullets.map((bullet, i) => (
            <>
              {/* leading-relaxed: deliberate prose override — session journal entry */}
              <p key={i} className="text-meta text-muted-foreground leading-relaxed">
                • {renderInline(bullet)}
              </p>
            </>
          ))}
          {entry.energy && (
            <p className="mt-2 text-label text-muted-foreground italic">
              ⚡ {renderInline(entry.energy)}
            </p>
          )}
          {entry.refs && (
            <>
              {/* leading-relaxed: deliberate prose override — continuation copy */}
              <p className="mt-1 text-label text-muted-foreground leading-relaxed">
                {renderInline(entry.refs)}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Sessions tab content ──

function SessionsTab() {
  const dp = useDataProvider()
  const [entries, setEntries] = useState<SessionEntry[]>([])
  const [raw, setRaw] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const content = await dp.dailyState.readSessionLog()
      setRaw(content)
      if (content) {
        setEntries(parseSessionLog(content))
      } else {
        setEntries([])
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [dp])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <p className="text-body text-destructive">
        Could not load session log: {error}
      </p>
    )
  }

  if (!raw) {
    return (
      <p className="text-body text-muted-foreground">
        No sessions yet today. They'll appear here as you work with Claude Code.
      </p>
    )
  }

  if (entries.length === 0) {
    return (
      <p className="text-body text-muted-foreground">
        Session log exists but no entries parsed yet.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {entries.map((entry, i) => (
        <SessionCard key={i} entry={entry} />
      ))}
    </div>
  )
}

// ── Main page ──

export function SessionPage() {
  return (
    <>
      <PageHeader title="Activity" />
      <div className="w-full max-w-3xl px-5 py-6">
        <Tabs defaultValue="timeline">
          <TabsList>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
          </TabsList>

          <TabsContent value="timeline">
            <ActivityTimeline />
          </TabsContent>
          <TabsContent value="sessions">
            <SessionsTab />
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}
