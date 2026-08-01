import { useState } from 'react'
import { cn } from '@/lib/utils'
import { ChevronRight, Check, Square } from 'lucide-react'

interface BriefDisplayProps {
  markdown: string
}

// ── Parse sections from markdown ──

interface BriefSection {
  title: string
  content: string
}

function parseBrief(markdown: string): { title: string; sections: BriefSection[] } {
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
    const sectionTitle = part.slice(0, newlineIdx).trim()
    const content = part.slice(newlineIdx + 1).trim()
    if (sectionTitle) sections.push({ title: sectionTitle, content })
  }

  return { title, sections }
}

// Key sections that should be open by default
const DEFAULT_OPEN = new Set([
  'Before You Start',
  'Core Habits',
  "Today's Shape",
  'Work',
  'Personal',
])

// ── Section component ──

function Section({ section }: { section: BriefSection }) {
  const [expanded, setExpanded] = useState(DEFAULT_OPEN.has(section.title))

  return (
    <div className="border-b border-border/20 last:border-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 py-2.5 text-left group"
      >
        <ChevronRight className={cn(
          'size-3 shrink-0 text-muted-foreground transition-transform duration-150',
          expanded && 'rotate-90',
        )} />
        <span className="text-label text-muted-foreground group-hover:text-muted-foreground transition-colors">
          {section.title}
        </span>
      </button>
      {expanded && (
        <div className="pb-3 pl-5 animate-in fade-in slide-in-from-top-1 duration-150">
          <MarkdownContent content={section.content} />
        </div>
      )}
    </div>
  )
}

// ── Markdown renderer ──

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // Skip horizontal rules
    if (line.trim() === '---') { i++; continue }

    // Skip empty lines
    if (line.trim() === '') { i++; continue }

    // Details/summary blocks (pass through as collapsible)
    if (line.trim().startsWith('<details')) {
      const detailLines: string[] = []
      while (i < lines.length && !lines[i].includes('</details>')) {
        detailLines.push(lines[i])
        i++
      }
      if (i < lines.length) { detailLines.push(lines[i]); i++ }
      const summaryMatch = detailLines.join('\n').match(/<summary>(?:<strong>)?(.+?)(?:<\/strong>)?<\/summary>/)
      const summaryText = summaryMatch ? summaryMatch[1].replace(/<\/?strong>/g, '') : 'Details'
      const innerContent = detailLines
        .filter(l => !l.includes('<details') && !l.includes('</details>') && !l.includes('<summary'))
        .join('\n')
        .trim()
      elements.push(
        <CollapsibleBlock key={key++} title={summaryText} content={innerContent} />
      )
      continue
    }

    // Table
    if (line.includes('|') && line.trim().startsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      elements.push(<MarkdownTable key={key++} lines={tableLines} />)
      continue
    }

    // H3 heading
    if (line.startsWith('### ')) {
      elements.push(
        <h4 key={key++} className="text-label mt-3 mb-1">
          {renderInline(line.slice(4))}
        </h4>
      )
      i++; continue
    }

    // Checkbox items
    if (line.match(/^\s*- \[([ x])\] /)) {
      const checked = line.includes('- [x]')
      const text = line.replace(/^\s*- \[[ x]\] /, '')
      elements.push(
        <div key={key++} className="flex items-center gap-2 py-0.5">
          {checked ? (
            <Check className="size-3.5 shrink-0 text-green-500" />
          ) : (
            <Square className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className={cn('text-body', checked && 'text-muted-foreground line-through')}>
            {renderInline(text)}
          </span>
        </div>
      )
      i++; continue
    }

    // Numbered list items
    if (line.match(/^\d+\.\s+\[([ x])\]\s+/)) {
      const checked = line.includes('[x]')
      const text = line.replace(/^\d+\.\s+\[[ x]\]\s+/, '')
      elements.push(
        <div key={key++} className="flex items-center gap-2 py-0.5">
          {checked ? (
            <Check className="size-3.5 shrink-0 text-green-500" />
          ) : (
            <Square className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className={cn('text-body', checked && 'text-muted-foreground line-through')}>
            {renderInline(text)}
          </span>
        </div>
      )
      i++; continue
    }

    // Regular list items
    if (line.match(/^\s*- /)) {
      const text = line.replace(/^\s*- /, '')
      elements.push(
        <div key={key++} className="flex items-start gap-2 py-0.5 pl-1">
          <span className="text-muted-foreground mt-1 text-meta">•</span>
          <span className="text-body">{renderInline(text)}</span>
        </div>
      )
      i++; continue
    }

    // Blockquote
    if (line.startsWith('>')) {
      const text = line.replace(/^>\s*/, '')
      if (text) {
        elements.push(
          <p key={key++} className="text-body text-muted-foreground italic border-l-2 border-border/30 pl-3 py-0.5">
            {renderInline(text)}
          </p>
        )
      }
      i++; continue
    }

    // Italic paragraph (*text*)
    if (line.startsWith('*') && line.endsWith('*') && !line.startsWith('**')) {
      elements.push(
        <p key={key++} className="text-body text-muted-foreground italic">
          {line.slice(1, -1)}
        </p>
      )
      i++; continue
    }

    // Regular paragraph
    elements.push(
      <p key={key++} className="text-body py-0.5">
        {renderInline(line)}
      </p>
    )
    i++
  }

  return <>{elements}</>
}

// ── Inline markdown rendering ──

function renderInline(text: string): React.ReactNode {
  // Handle **bold** and *italic*
  const parts: React.ReactNode[] = []
  let remaining = text
  let partKey = 0

  while (remaining.length > 0) {
    // Bold
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/)
    if (boldMatch && boldMatch.index !== undefined) {
      if (boldMatch.index > 0) parts.push(remaining.slice(0, boldMatch.index))
      parts.push(<strong key={partKey++}>{boldMatch[1]}</strong>)
      remaining = remaining.slice(boldMatch.index + boldMatch[0].length)
      continue
    }
    // No more matches
    parts.push(remaining)
    break
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>
}

// ── Table ──

function MarkdownTable({ lines }: { lines: string[] }) {
  const rows = lines
    .filter(l => !l.match(/^\|[\s-|]+\|$/)) // skip separator rows
    .map(l => l.split('|').slice(1, -1).map(cell => cell.trim()))

  if (rows.length === 0) return null
  const header = rows[0]
  const body = rows.slice(1)

  return (
    <div className="my-1 text-meta">
      <div className="grid gap-x-4" style={{ gridTemplateColumns: `repeat(${header.length}, auto)` }}>
        {header.map((cell, i) => (
          <span key={i} className="font-medium text-muted-foreground py-0.5">
            {cell}
          </span>
        ))}
        {body.map((row, ri) =>
          row.map((cell, ci) => (
            <span key={`${ri}-${ci}`} className={cn('py-0.5', cell.startsWith('**') ? 'font-medium' : '')}>
              {renderInline(cell)}
            </span>
          ))
        )}
      </div>
    </div>
  )
}

// ── Collapsible block ──

function CollapsibleBlock({ title, content }: { title: string; content: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-meta text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className={cn('size-2.5 transition-transform', open && 'rotate-90')} />
        {title}
      </button>
      {open && (
        <div className="mt-1 pl-4 animate-in fade-in duration-150">
          <MarkdownContent content={content} />
        </div>
      )}
    </div>
  )
}

// ── Main component ──

export function BriefDisplay({ markdown }: BriefDisplayProps) {
  const { title, sections } = parseBrief(markdown)

  if (sections.length === 0) {
    return <p className="text-body text-muted-foreground">Brief is empty.</p>
  }

  return (
    <div>
      {title && (
        <p className="text-meta text-muted-foreground mb-2">{title}</p>
      )}
      <div>
        {sections.map((section, i) => (
          <Section key={i} section={section} />
        ))}
      </div>
    </div>
  )
}
