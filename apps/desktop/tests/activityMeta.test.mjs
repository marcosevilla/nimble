import test from 'node:test'
import assert from 'node:assert/strict'
import { ACTION_META, ACTIVITY_COLORS } from '../src/lib/activityMeta.ts'

// Session P1-5: one shared table, four semantic colors (created/completed,
// deleted, focus/moves, everything else) — never a Tailwind palette hue.
const ALLOWED = new Set(['text-success', 'text-destructive', 'text-accent-blue', 'text-muted-foreground'])

test('ACTIVITY_COLORS exposes exactly the four semantic roles', () => {
  assert.deepEqual(new Set(Object.values(ACTIVITY_COLORS)), ALLOWED)
})

test('every action has a sentence-case label, an icon and one of the four colors', () => {
  const keys = Object.keys(ACTION_META)
  assert.ok(keys.length >= 40, `expected the full 43-row table, got ${keys.length}`)
  for (const [key, meta] of Object.entries(ACTION_META)) {
    assert.equal(typeof meta.label, 'string', key)
    assert.ok(meta.label.trim().length > 0, key)
    assert.equal(meta.label[0], meta.label[0].toUpperCase(), `${key}: label starts lowercase`)
    // lucide icons are React.forwardRef exotic objects, not plain functions
    assert.ok(meta.icon && (typeof meta.icon === 'function' || typeof meta.icon.render === 'function'), `: icon should be a lucide component`)
    assert.ok(ALLOWED.has(meta.color), `${key}: ${meta.color} is not a semantic color`)
    if (meta.shortLabel != null) assert.ok(meta.shortLabel.trim().length > 0, key)
  }
})

test('created/completed are success, deleted is destructive, focus starts and moves are accent-blue', () => {
  for (const k of Object.keys(ACTION_META)) {
    if (k.endsWith('_deleted')) assert.equal(ACTION_META[k].color, 'text-destructive', k)
    else if (k.endsWith('_created') || k.endsWith('_completed')) assert.equal(ACTION_META[k].color, 'text-success', k)
  }
  for (const k of ['focus_started', 'focus_resumed', 'task_moved', 'capture_converted', 'capture_routed', 'todoist_migrated', 'vault_import']) {
    assert.equal(ACTION_META[k].color, 'text-accent-blue', k)
  }
  for (const k of ['task_updated', 'status_changed', 'priorities_generated', 'task_breakdown_requested', 'focus_paused', 'app_opened']) {
    assert.equal(ACTION_META[k].color, 'text-muted-foreground', k)
  }
})

test('task-detail short labels exist for the task-scoped actions', () => {
  for (const k of ['task_created', 'task_completed', 'task_deleted', 'focus_started', 'task_breakdown_applied']) {
    assert.equal(typeof ACTION_META[k].shortLabel, 'string', k)
  }
})
