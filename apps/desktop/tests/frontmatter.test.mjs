import test from 'node:test'
import assert from 'node:assert/strict'
import { splitFrontmatter } from '../src/lib/frontmatter.ts'

test('splits a leading YAML block into chips and returns the body without it', () => {
  const src = '---\ntype: capture\ntags: [inbox, photo]\ndate: 2026-07-30\n---\n# Quick capture\n\nBody text.\n'
  const { fields, body } = splitFrontmatter(src)
  assert.deepEqual(fields, [
    { key: 'type', value: 'capture' },
    { key: 'tags', value: 'inbox, photo' },
    { key: 'date', value: '2026-07-30' },
  ])
  assert.equal(body, '# Quick capture\n\nBody text.\n')
})

test('a note without frontmatter comes back untouched with no chips', () => {
  const src = '# Plain note\n\n---\n\nA rule mid-body is not frontmatter.\n'
  const { fields, body } = splitFrontmatter(src)
  assert.deepEqual(fields, [])
  assert.equal(body, src)
})

test('an unterminated fence is body, not frontmatter', () => {
  const src = '---\ntitle: oops\nno closing fence\n'
  const { fields, body } = splitFrontmatter(src)
  assert.deepEqual(fields, [])
  assert.equal(body, src)
})

test('multi-line yaml lists collapse into one comma-joined chip', () => {
  const src = '---\ntags:\n  - inbox\n  - photo\nstatus: open\n---\nbody'
  const { fields } = splitFrontmatter(src)
  assert.deepEqual(fields, [
    { key: 'tags', value: 'inbox, photo' },
    { key: 'status', value: 'open' },
  ])
})

test('an empty block is stripped, not rendered as two rules', () => {
  const { fields, body } = splitFrontmatter('---\n---\n# Title\n')
  assert.deepEqual(fields, [])
  assert.equal(body, '# Title\n')
})

test('a leading BOM does not defeat the fence', () => {
  const { fields, body } = splitFrontmatter('﻿---\ntype: capture\n---\nbody')
  assert.deepEqual(fields, [{ key: 'type', value: 'capture' }])
  assert.equal(body, 'body')
})
