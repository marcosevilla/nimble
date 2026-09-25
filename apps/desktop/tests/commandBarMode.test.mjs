import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMode } from '../src/lib/commandBarMode.ts'

const route = (id, prefix, target_type = 'doc') => ({
  id, prefix, target_type, doc_id: null, label: id, color: '#000', icon: 'FileText', position: 0, created_at: '',
})

function assertSuffix(raw, query) {
  assert.ok(raw.endsWith(query), `expected "${query}" to be a suffix of "${raw}"`)
}

test('/task wins over a user route even when a /t route exists', () => {
  const routes = [route('task-route', '/t', 'task')]
  const { mode, query, route: r } = parseMode('/task x', routes)
  assert.equal(mode, 'task')
  assert.equal(query, 'x')
  assert.equal(r, null)
  assertSuffix('/task x', query)
})

test('/note and /capture are silent aliases for capture mode', () => {
  const a = parseMode('/note x', [])
  assert.equal(a.mode, 'capture')
  assert.equal(a.query, 'x')
  assertSuffix('/note x', a.query)

  const b = parseMode('/capture x', [])
  assert.equal(b.mode, 'capture')
  assert.equal(b.query, 'x')
  assertSuffix('/capture x', b.query)
})

test('/doc is doc mode', () => {
  const { mode, query } = parseMode('/doc x', [])
  assert.equal(mode, 'doc')
  assert.equal(query, 'x')
  assertSuffix('/doc x', query)
})

test('a user route /docs is not shadowed by the built-in /doc check', () => {
  const routes = [route('docs-route', '/docs')]
  const { mode, route: r, query } = parseMode('/docs foo', routes)
  assert.equal(mode, 'route')
  assert.equal(r?.id, 'docs-route')
  assert.equal(query, 'foo')
  assertSuffix('/docs foo', query)
})

test('/i matches a user route with its content', () => {
  const routes = [route('ideas', '/i')]
  const { mode, route: r, query } = parseMode('/i film', routes)
  assert.equal(mode, 'route')
  assert.equal(r?.id, 'ideas')
  assert.equal(query, 'film')
  assertSuffix('/i film', query)
})

test('plain text with no prefix is search mode', () => {
  const { mode, query, route: r } = parseMode('call mom', [])
  assert.equal(mode, 'search')
  assert.equal(query, 'call mom')
  assert.equal(r, null)
  assertSuffix('call mom', query)
})

test('query is always a suffix of the raw input, including leading spaces', () => {
  const routes = [route('ideas', '/i')]
  const cases = [
    '  /task x',
    '  /note x',
    '  /capture x',
    '  /doc x',
    '  /search x',
    '  /i film',
    '  call mom',
  ]
  for (const raw of cases) {
    const { query } = parseMode(raw, routes)
    assertSuffix(raw, query)
  }
})

import { searchHandoff } from '../src/lib/commandBarMode.ts'

test('/search hands its text to ⌘F; other input stays in ⌘K', () => {
  assert.equal(searchHandoff('/search '), '')
  assert.equal(searchHandoff('  /search portfolio deck'), 'portfolio deck')
  assert.equal(searchHandoff('/search'), null, 'not until the space')
  assert.equal(searchHandoff('portfolio'), null)
  assert.equal(searchHandoff('/searching'), null)
})
