import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FALLBACK_LAYOUT, normalizeLayout, configValue, setModuleConfig, setModuleEnabled, applySettingsPatch, arrangeBrief,
} from '../src/lib/briefLayout.ts'

const e = (id, enabled = true, config = {}) => ({ id, enabled, config })

test('phase-1 layouts (module ids) and phase-2 layouts (entries) both normalize', () => {
  assert.deepEqual(normalizeLayout(['schedule', 'priorities']), [e('schedule'), e('priorities')])
  assert.deepEqual(
    normalizeLayout([{ id: 'schedule', enabled: false, config: { free_block: false } }, { id: 'schedule' }, { id: 'vault' }]),
    [e('schedule', false, { free_block: false }), e('vault')],
  )
})

test('garbage layouts read as the phase-1 fallback', () => {
  for (const bad of [null, undefined, 'x', {}, 3]) assert.deepEqual(normalizeLayout(bad), FALLBACK_LAYOUT)
  assert.deepEqual(normalizeLayout([1, null, { enabled: true }]), [])
  assert.deepEqual(FALLBACK_LAYOUT.map((x) => x.id), ['schedule', 'priorities', 'due_today', 'still_open', 'vault'])
})

test('configValue keeps the stored value only when it has the fallback type', () => {
  assert.equal(configValue({ count: 5 }, 'count', 3), 5)
  assert.equal(configValue({ count: '5' }, 'count', 3), 3)
  assert.equal(configValue(undefined, 'rain_notes', true), true)
})

test('module edits return new arrays and leave other entries alone', () => {
  const list = [e('schedule'), e('weather', true, { units: 'auto', rain_notes: true })]
  const units = setModuleConfig(list, 'weather', { units: 'C' })
  assert.deepEqual(units[1].config, { units: 'C', rain_notes: true })
  assert.notEqual(units, list)
  assert.equal(units[0], list[0])
  assert.equal(setModuleEnabled(list, 'schedule', false)[0].enabled, false)
})

test('applySettingsPatch merges optimistically: goals shallow-merge, null location clears', () => {
  const base = {
    time: '06:30', location: { name: 'SF', lat: 1, lon: 2, tz: 'UTC' }, modules: [], model: 'claude-opus-5-5', effort: 'low',
    setup_completed_at: null, goals: { daily: 5, weekly: 25, days_off: ['sat', 'sun'] },
    sources: { calendar: false, tasks: false, vault: false, ai: false }, manifests: [],
  }
  const next = applySettingsPatch(base, { time: '07:00', location: null, goals: { daily: 3 } })
  assert.equal(next.time, '07:00')
  assert.equal(next.location, null)
  assert.deepEqual(next.goals, { daily: 3, weekly: 25, days_off: ['sat', 'sun'] })
  assert.equal(base.time, '06:30', 'input untouched')
  assert.equal(applySettingsPatch(base, {}).location, base.location)
})

test('arrangeBrief: header modules in the header, strip modules collapse when compact', () => {
  const info = (id) => ({ slot: id === 'weather' ? 'header' : undefined, strip: ['weather', 'schedule', 'priorities'].includes(id) })
  const list = [e('weather'), e('schedule'), e('priorities'), e('due_today'), e('habits', false), e('vault')]
  const open = arrangeBrief(list, info, false)
  assert.deepEqual(open.header.map((x) => x.id), ['weather'])
  assert.deepEqual(open.strip, [])
  assert.deepEqual(open.body.map((x) => x.id), ['schedule', 'priorities', 'due_today', 'vault'])
  const compact = arrangeBrief(list, info, true)
  assert.deepEqual(compact.header, [], 'the chip moves into the strip (UX checkpoint 1)')
  assert.deepEqual(compact.strip.map((x) => x.id), ['weather', 'schedule', 'priorities'])
  assert.deepEqual(compact.body.map((x) => x.id), ['due_today', 'vault'])
})
