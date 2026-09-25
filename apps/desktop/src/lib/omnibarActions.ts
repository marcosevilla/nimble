/* Omnibar Actions group (spec 2026-09-25, decisions table: "Mixed into the
   same result list as their own Actions group"). ⌘K had no action source
   before the Omnibar (plan decision), so this is the list; every entry
   mirrors a shortcut that already exists and shows it. Pure —
   tests/omnibarActions.test.mjs. The runner lives in components/omnibar/Omnibar.tsx. */
import { fold } from './omnibarQuery.ts'

export type OmnibarActionId =
  | 'go-today'
  | 'go-tasks'
  | 'go-inbox'
  | 'go-docs'
  | 'go-goals'
  | 'go-settings'
  | 'go-activity'
  | 'toggle-focus'
  | 'toggle-habits'
  | 'shortcuts'
  | 'refresh'

export interface OmnibarAction {
  id: OmnibarActionId
  label: string
  /** Extra words that find it ("preferences" → Settings). */
  keywords: string[]
  /** The existing shortcut (a `lib/shortcuts.ts` `keys` string). */
  hint: string
}

export const OMNIBAR_ACTIONS: readonly OmnibarAction[] = [
  { id: 'go-today', label: 'Go to Today', keywords: ['brief', 'home', 'morning'], hint: 'g t' },
  { id: 'go-tasks', label: 'Go to Tasks', keywords: ['projects', 'list'], hint: 'g k' },
  { id: 'go-inbox', label: 'Go to Inbox', keywords: ['notes', 'captures'], hint: 'g i' },
  { id: 'go-docs', label: 'Go to Docs', keywords: ['documents', 'vault', 'obsidian'], hint: 'g d' },
  { id: 'go-goals', label: 'Go to Goals', keywords: ['habits', 'milestones'], hint: 'g g' },
  { id: 'go-settings', label: 'Go to Settings', keywords: ['preferences', 'options'], hint: '⌘,' },
  { id: 'go-activity', label: 'Go to Activity', keywords: ['log', 'history'], hint: 'g s' },
  { id: 'toggle-focus', label: 'Open or close the focus queue', keywords: ['focus', 'queue', 'timer'], hint: '⇧F' },
  { id: 'toggle-habits', label: 'Open or close habits', keywords: ['habits'], hint: '⇧H' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', keywords: ['help', 'keys'], hint: '?' },
  { id: 'refresh', label: 'Refresh all data', keywords: ['reload', 'sync'], hint: '⌘R' },
]

/** Every typed word must start a word of the label or a keyword. An empty
 *  query returns the whole list (the empty-bar default). */
export function matchActions(text: string, actions: readonly OmnibarAction[] = OMNIBAR_ACTIONS): OmnibarAction[] {
  const words = fold(text).split(' ').filter(Boolean)
  if (words.length === 0) return [...actions]
  return actions.filter((a) => {
    const own = fold([a.label, ...a.keywords].join(' ')).split(' ')
    return words.every((w) => own.some((o) => o.startsWith(w)))
  })
}
