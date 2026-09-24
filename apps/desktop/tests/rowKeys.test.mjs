// T2 — focused-row picker keys p · ⇧D · l · m (loop 2 chunk 3).
//
// Module contract (to be created by the T2 builder):
//   path:   apps/desktop/src/lib/rowPickerKeys.ts  (plain TS, no JSX, no `@/`
//           imports; import siblings with a `.ts` suffix if needed)
//   export type RowPickerKind = 'priority' | 'due' | 'label' | 'project'
//     — the same strings as rowMarks.ts `RowMarkKind`, so the result can go
//       straight into `useRowPickerStore.getState().openPicker(rowId, kind)`.
//   export const ROW_PICKER_KEYS: Readonly<Record<string, RowPickerKind>>
//     — exactly { p: 'priority', D: 'due', l: 'label', m: 'project' },
//       keyed by KeyboardEvent.key (⇧D arrives as 'D').
//   export function rowPickerKind(e: {
//     key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; repeat?: boolean
//   }): RowPickerKind | null
//     — the kind for a bare p / D / l / m; null for anything else, for any
//       ⌘ / ⌃ / ⌥ combo and for auto-repeat. Plain 'd' is null (it is the
//       Inbox note's dismiss), as are 'P', 'L', 'M'.
//
// Registry contract (src/lib/shortcuts.ts): four rows appended to the end of
// SHORTCUTS in section 'Tasks' with keys exactly 'p', '⇧D', 'l', 'm' and
// labels mentioning priority / due / label / project. None of the four may
// collide with a key already live on the Tasks, project, Today or Inbox
// pages (x s f j k Enter, the g prefix, digits, ⇧F, ⇧H, q, ?, Space, Today's
// b [ ], Inbox's c t d). `m` is shared with the Inbox NOTE row's "Move to a
// doc" on purpose: note rows keep it, task rows get the project picker.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ROW_PICKER_KEYS, rowPickerKind } from '../src/lib/rowPickerKeys.ts'
import { SHORTCUTS, G_PREFIX_PAGES } from '../src/lib/shortcuts.ts'
import { decideRowKey } from '../src/lib/rowNav.ts'

// ── the mapping ──

test('ROW_PICKER_KEYS maps exactly p, D, l and m to the four picker kinds', () => {
  assert.deepEqual({ ...ROW_PICKER_KEYS }, { p: 'priority', D: 'due', l: 'label', m: 'project' })
})

test('rowPickerKind: bare p / ⇧D / l / m open their picker', () => {
  assert.equal(rowPickerKind({ key: 'p' }), 'priority')
  assert.equal(rowPickerKind({ key: 'D' }), 'due')
  assert.equal(rowPickerKind({ key: 'l' }), 'label')
  assert.equal(rowPickerKind({ key: 'm' }), 'project')
  assert.equal(rowPickerKind({ key: 'm', metaKey: false, ctrlKey: false, altKey: false, repeat: false }), 'project')
})

test('rowPickerKind: every other key is null (including plain d and shifted P / L / M)', () => {
  for (const key of ['d', 'P', 'L', 'M', 'x', 's', 'f', 'j', 'k', 'q', 'g', 't', 'c', 'b', 'F', 'H', 'Enter', 'Escape', ' ', '1', '?', 'Shift', '']) {
    assert.equal(rowPickerKind({ key }), null, `key ${JSON.stringify(key)}`)
  }
})

test('rowPickerKind: ⌘ / ⌃ / ⌥ combos and auto-repeat are null', () => {
  for (const key of ['p', 'D', 'l', 'm']) {
    assert.equal(rowPickerKind({ key, metaKey: true }), null, `⌘${key}`)
    assert.equal(rowPickerKind({ key, ctrlKey: true }), null, `⌃${key}`)
    assert.equal(rowPickerKind({ key, altKey: true }), null, `⌥${key}`)
    assert.equal(rowPickerKind({ key, repeat: true }), null, `${key} held`)
  }
})

// ── the registry ──

const NEW = [
  { keys: 'p', label: /priority/i },
  { keys: '⇧D', label: /due/i },
  { keys: 'l', label: /label/i },
  { keys: 'm', label: /project/i },
]

test('shortcuts registry: the Tasks section lists p, ⇧D, l and m with matching labels', () => {
  for (const { keys, label } of NEW) {
    const row = SHORTCUTS.find((s) => s.section === 'Tasks' && s.keys === keys)
    assert.ok(row, `Tasks missing ${keys}`)
    assert.match(row.label, label, `${keys} label`)
  }
})

test('shortcuts registry: the four rows are appended after every existing row', () => {
  const at = NEW.map(({ keys }) => SHORTCUTS.findIndex((s) => s.section === 'Tasks' && s.keys === keys))
  for (const i of at) assert.ok(i >= 0)
  const lastCapture = SHORTCUTS.map((s) => s.section).lastIndexOf('Capture')
  for (const i of at) assert.ok(i > lastCapture, 'new rows go at the end, never above existing ones')
})

/** Bare event keys a display string stands for; combos with ⌘/⌥/⌃ can't collide with a bare key. */
function eventKeys(display) {
  if (/[⌘⌥⌃]/.test(display) || display.startsWith('/') || /click/i.test(display)) return []
  if (display === '1–5') return ['1', '2', '3', '4', '5']
  if (display === 'Space') return [' ']
  if (/^g .$/.test(display)) return ['g']
  const out = []
  for (const part of display.split(' / ')) {
    const p = part.replace(/\s*\(.*\)$/, '').trim()
    if (p.startsWith('⇧')) out.push(p.slice(1).toUpperCase())
    else if (p === '↓') out.push('ArrowDown')
    else if (p === '↑') out.push('ArrowUp')
    else if (p === '←') out.push('ArrowLeft')
    else if (p === '→') out.push('ArrowRight')
    else out.push(p)
  }
  return out
}

// Sections whose keys are live on the pages that carry task rows.
const LIVE_ON = {
  tasks: ['Navigation', 'Tasks', 'Focus', 'Selection', 'General', 'Goals'],
  today: ['Navigation', 'Tasks', 'Focus', 'Selection', 'General', 'Goals', 'Today'],
  inbox: ['Navigation', 'Tasks', 'Focus', 'Selection', 'General', 'Goals', 'Inbox'],
}
// Goals' in-page keys (habit Enter/Space, timeline T) aren't live off Goals; ⇧H is global.
const GOALS_GLOBAL = new Set(['⇧H'])

test('no collision: the four keys are free on Tasks, project, Today and Inbox pages (Inbox note m excepted)', () => {
  const isNew = (s) => s.section === 'Tasks' && NEW.some((n) => n.keys === s.keys)
  for (const [pageName, sections] of Object.entries(LIVE_ON)) {
    const live = SHORTCUTS.filter((s) => sections.includes(s.section) && !isNew(s))
      .filter((s) => s.section !== 'Goals' || GOALS_GLOBAL.has(s.keys))
    for (const key of Object.keys(ROW_PICKER_KEYS)) {
      const clashes = live.filter((s) => eventKeys(s.keys).includes(key))
        // Inbox note rows keep `m` (Move to a doc); task rows get the project picker.
        .filter((s) => !(pageName === 'inbox' && s.section === 'Inbox' && s.keys === 'm'))
      assert.deepEqual(clashes.map((s) => `${s.section} ${s.keys}`), [], `${key} on ${pageName}`)
    }
  }
})

test('no collision with the named row keys, the g prefix, digits, ⇧F, ⇧H or q', () => {
  const taken = ['x', 's', 'f', 'j', 'k', 'Enter', 'g', 'F', 'H', 'q', '1', '2', '3', '4', '5', '?', ' ', 'd', 't', 'c', 'b']
  for (const key of Object.keys(ROW_PICKER_KEYS)) assert.ok(!taken.includes(key), `${key} is already taken`)
  // A pending `g` doesn't swallow them either: none is a g-chord target.
  for (const key of Object.keys(ROW_PICKER_KEYS)) assert.ok(!(key in G_PREFIX_PAGES), `g ${key} is a chord`)
})

test('the Inbox keeps its note keys t, m and d', () => {
  const inbox = SHORTCUTS.filter((s) => s.section === 'Inbox').map((s) => s.keys)
  for (const k of ['t', 'm', 'd']) assert.ok(inbox.includes(k), `Inbox ${k}`)
})

// ── the row-key guard keeps skipping these keys where it must ──

function el({ tag = 'div', attrs = {}, within = [] } = {}) {
  const matchesSel = (sel, node) =>
    sel.split(',').map((x) => x.trim()).some((x) => {
      if (x === node.tag) return true
      const attr = x.match(/^\[([a-z-]+)(?:="([^"]*)")?\]$/)
      if (attr) return attr[2] === undefined ? attr[1] in node.attrs : node.attrs[attr[1]] === attr[2]
      if (/^[a-z]+$/.test(x)) return node.tag === x
      if (x.startsWith('[contenteditable]')) return 'contenteditable' in node.attrs && node.attrs.contenteditable !== 'false'
      return false
    })
  const self = { tag, attrs }
  const chain = [self, ...within]
  return {
    isContentEditable: false,
    matches: (sel) => matchesSel(sel, self),
    closest: (sel) => {
      const hit = chain.find((n) => matchesSel(sel, n))
      return hit ? { getAttribute: (a) => hit.attrs[a] ?? null } : null
    },
    getAttribute: (a) => attrs[a] ?? null,
  }
}

test('decideRowKey still skips p / D / l / m from fields, open overlays and the nav tree', () => {
  const input = el({ tag: 'input' })
  const inMenu = el({ tag: 'button', within: [{ tag: 'div', attrs: { role: 'menu' } }] })
  const inDialog = el({ tag: 'button', within: [{ tag: 'div', attrs: { role: 'dialog' } }] })
  const inTree = el({ tag: 'button', attrs: { role: 'treeitem' }, within: [{ tag: 'div', attrs: { role: 'tree' } }] })
  for (const key of ['p', 'D', 'l', 'm']) {
    for (const [what, t] of [['input', input], ['menu', inMenu], ['dialog', inDialog], ['tree', inTree]]) {
      assert.equal(decideRowKey(t, key).handle, false, `${key} from ${what}`)
    }
  }
  const row = el({ tag: 'div', attrs: { 'data-nav-row': 'task-05' } })
  assert.deepEqual(decideRowKey(row, 'p'), { handle: true, rowId: 'task-05' })
})
