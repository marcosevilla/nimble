import { useMemo, type ReactNode } from 'react'
import { ArrowRight, FileText, History, ListFilter, PenLine, Plus, Target, Vault } from 'lucide-react'
import type { LocalTask, Project } from '@nimble/types'
import { cn } from '@/lib/utils'
import { suggestionText } from '@/lib/omnibarQuery'
import { CREATE_NAME } from '@/lib/omnibarCreate'
import { flattenRows, OMNIBAR_LISTBOX_ID, optionId, type OmnibarRow, type RowSection } from '@/lib/omnibarRows'
import { Icon } from '@/components/shared/Icon'
import { Meta } from '@/components/shared/typography'
import { DateChip } from '@/components/capture/CaptureTokens'
import { TaskRow } from './OmnibarRows'

type CreateRow = Extract<OmnibarRow, { kind: 'create' }>

const isCreateRow = (r: OmnibarRow): r is CreateRow => r.kind === 'create'

const ROW_CLASS = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body transition-colors'
const KBD_CLASS = 'rounded-sm bg-muted px-1 py-0.5 text-label text-muted-foreground'

export interface OmnibarResultsProps {
  sections: readonly RowSection[]
  selectedKey: string | null
  /** Fetched rows belong to an older query (a newer search is in flight). */
  busy: boolean
  tokens: readonly string[]
  projects: readonly Project[]
  /** The typed text a create row quotes. */
  createText: string
  /** The task title after any parsed date is split out. */
  createTaskTitle: string
  createDateLabel: string | null
  onHover: (key: string) => void
  onActivate: (row: OmnibarRow) => void
  onComplete: (task: LocalTask) => void
  onBreakDown: (task: LocalTask) => void
  onMove: (task: LocalTask, projectId: string) => void
}

/** Keeps focus in the combobox input when a row or chip is clicked. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault()

function RowOption({ row, id, selected, onHover, onActivate, children }: {
  row: OmnibarRow
  id: string
  selected: boolean
  onHover: (key: string) => void
  onActivate: (row: OmnibarRow) => void
  children: ReactNode
}) {
  return (
    <div
      role="option"
      id={id}
      aria-selected={selected}
      data-omnibar-row={row.key}
      data-selected={selected || undefined}
      onMouseEnter={() => onHover(row.key)}
      onMouseDown={keepFocus}
      onClick={() => onActivate(row)}
      className={cn(ROW_CLASS, selected && 'bg-hover')}
    >
      {children}
    </div>
  )
}

function rowBody(row: OmnibarRow, firstFilter: boolean): ReactNode {
  switch (row.kind) {
    case 'filter':
      return (
        <>
          <Icon icon={ListFilter} className="text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{suggestionText(row.suggestion)}</span>
          {firstFilter && <kbd className={KBD_CLASS}>Tab</kbd>}
        </>
      )
    case 'recent':
      return (
        <>
          <Icon icon={History} className="text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{row.query}</span>
        </>
      )
    case 'note':
      return (
        <>
          <Icon icon={PenLine} className="text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{row.capture.content}</span>
        </>
      )
    case 'doc':
      return row.doc.backend === 'native' ? (
        <>
          <Icon icon={FileText} className="text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{row.doc.doc.title || 'Untitled'}</span>
        </>
      ) : (
        <>
          <Icon icon={Vault} className="text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{row.doc.note.title || row.doc.note.path}</span>
          <Meta className="shrink-0">Vault</Meta>
        </>
      )
    case 'goal':
      return (
        <>
          <Icon icon={Target} className="text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{row.goal.name}</span>
        </>
      )
    case 'action':
      return (
        <>
          <Icon icon={ArrowRight} className="text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{row.action.label}</span>
          <kbd className={KBD_CLASS}>{row.action.hint}</kbd>
        </>
      )
    case 'more':
      return <Meta className="pl-6">Show all {row.total}</Meta>
    default:
      return null
  }
}

function CreateRows({ rows, idOf, selectedKey, createText, createTaskTitle, createDateLabel, onHover, onActivate }: {
  rows: CreateRow[]
  idOf: (key: string) => string
  selectedKey: string | null
  createText: string
  createTaskTitle: string
  createDateLabel: string | null
  onHover: (key: string) => void
  onActivate: (row: OmnibarRow) => void
}) {
  const [first, ...rest] = rows
  if (!first) return null
  const firstSelected = first.key === selectedKey
  const isTask = first.create === 'task'
  return (
    <>
      <RowOption row={first} id={idOf(first.key)} selected={firstSelected} onHover={onHover} onActivate={onActivate}>
        <Icon icon={Plus} className="text-muted-foreground" />
        <span className="text-muted-foreground">Create {CREATE_NAME[first.create].toLowerCase()}</span>
        <span className="min-w-0 flex-1 truncate text-body-strong">"{isTask ? createTaskTitle : createText}"</span>
        {isTask && createDateLabel && <DateChip label={createDateLabel} />}
        {firstSelected && <kbd className={KBD_CLASS}>Enter</kbd>}
      </RowOption>
      {rest.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 px-2 pb-1 pt-0.5">
          <Meta className="mr-1" aria-hidden>or create</Meta>
          {rest.map((row) => {
            const selected = row.key === selectedKey
            return (
              <div
                key={row.key}
                role="option"
                id={idOf(row.key)}
                aria-selected={selected}
                data-omnibar-row={row.key}
                data-selected={selected || undefined}
                aria-label={`Create ${CREATE_NAME[row.create].toLowerCase()} "${createText}"`}
                onMouseEnter={() => onHover(row.key)}
                onMouseDown={keepFocus}
                onClick={() => onActivate(row)}
                className={cn(
                  'rounded-md px-2 py-0.5 text-meta text-muted-foreground transition-colors hover:bg-hover hover:text-foreground',
                  selected && 'bg-hover text-foreground',
                )}
              >
                {CREATE_NAME[row.create]}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

/** Grouped Omnibar results: a `role="listbox"` (the field's combobox
 *  controls it) holding one `role="group"` per section, named by its title.
 *  Each row is a `role="option"` with an index-based id, marked
 *  `data-omnibar-row` / `data-selected`. Rows are not tab stops — the field
 *  owns the keyboard and points at the highlighted row with
 *  aria-activedescendant (Omnibar.tsx). */
export function OmnibarResults(props: OmnibarResultsProps) {
  const { sections, selectedKey, onHover, onActivate } = props
  const indexByKey = useMemo(() => new Map(flattenRows(sections).map((r, i) => [r.key, i])), [sections])
  const idOf = (key: string) => optionId(indexByKey.get(key) ?? -1)
  return (
    <div className="overflow-hidden rounded-xl border border-border/50 bg-popover shadow-lg">
      <div
        id={OMNIBAR_LISTBOX_ID}
        role="listbox"
        aria-label="Results"
        aria-busy={props.busy || undefined}
        className="max-h-[min(60vh,28rem)] overflow-y-auto p-1"
      >
        {sections.map((section, si) => (
          <div
            key={section.key}
            role="group"
            aria-label={section.title}
            className={cn(si > 0 && 'mt-1 border-t border-border/30 pt-1')}
          >
            <div className="px-2 py-1" aria-hidden>
              <span className="text-label text-muted-foreground">{section.title}</span>
            </div>
            {section.key === 'create' ? (
              <CreateRows
                rows={section.rows.filter(isCreateRow)}
                idOf={idOf}
                selectedKey={selectedKey}
                createText={props.createText}
                createTaskTitle={props.createTaskTitle}
                createDateLabel={props.createDateLabel}
                onHover={onHover}
                onActivate={onActivate}
              />
            ) : (
              section.rows.map((row, i) =>
                row.kind === 'task' ? (
                  <TaskRow
                    key={row.key}
                    rowKey={row.key}
                    optionId={idOf(row.key)}
                    hit={row.hit}
                    selected={row.key === selectedKey}
                    tokens={props.tokens}
                    projects={props.projects}
                    onHover={() => onHover(row.key)}
                    onOpen={() => onActivate(row)}
                    onComplete={() => props.onComplete(row.hit.task)}
                    onBreakDown={() => props.onBreakDown(row.hit.task)}
                    onMove={(projectId) => props.onMove(row.hit.task, projectId)}
                  />
                ) : (
                  <RowOption key={row.key} row={row} id={idOf(row.key)} selected={row.key === selectedKey} onHover={onHover} onActivate={onActivate}>
                    {rowBody(row, section.key === 'filters' && i === 0)}
                  </RowOption>
                ),
              )
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
