import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The vault-root today.md was the pre-brief daily note. Today's brief no
// longer reads it, and every load used to hit the read — a toast on the Mac
// when the file was gone, a "not implemented" rejection on the web. The read
// (useObsidian, TodayPanel, HabitsPanel, obsidian.readTodayMd /
// toggleCheckbox) is gone from the frontend and the DataProvider contract.
const root = fileURLToPath(new URL('../src', import.meta.url))
const types = fileURLToPath(new URL('../../../packages/types/src', import.meta.url))

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : []
  })
}

test('nothing in the frontend or the provider contract reads the legacy today.md', () => {
  const hits = [...files(root), ...files(types)].filter((f) =>
    /readTodayMd|read_today_md|toggle_obsidian_checkbox|useObsidian|obsidianToday/.test(readFileSync(f, 'utf8')),
  )
  assert.deepEqual(hits, [])
})
