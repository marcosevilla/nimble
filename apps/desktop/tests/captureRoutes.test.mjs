import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRoutePrefix, validateRoutePrefix, RESERVED_PREFIXES } from '../src/lib/captureRoutes.ts'

const route = (id, prefix, target_type = 'doc') => ({
  id, prefix, target_type, doc_id: null, label: id, color: '#000', icon: 'FileText', position: 0, created_at: '',
})
const ROUTES = [route('ideas', '/i'), route('quotes', '/q'), route('task', '/t', 'task')]

test('reserved prefixes are the command bar modes and aliases', () => {
  assert.deepEqual([...RESERVED_PREFIXES], ['/doc', '/search', '/task', '/note', '/capture'])
})

test('validateRoutePrefix accepts a new, well-formed prefix', () => {
  assert.equal(validateRoutePrefix('/w', ROUTES), null)
  assert.equal(validateRoutePrefix('  /work  ', ROUTES), null)
})

test('validateRoutePrefix refuses malformed prefixes', () => {
  assert.equal(validateRoutePrefix('', ROUTES), 'Prefix is required')
  assert.equal(validateRoutePrefix('w', ROUTES), 'Prefix must start with /')
  assert.equal(validateRoutePrefix('/', ROUTES), 'Add at least one letter after /')
  assert.equal(validateRoutePrefix('/a b', ROUTES), "Prefix can't contain spaces")
})

test('validateRoutePrefix refuses reserved prefixes in any case', () => {
  assert.equal(validateRoutePrefix('/doc', ROUTES), '/doc is reserved for the command bar')
  assert.equal(validateRoutePrefix('/Search', ROUTES), '/Search is reserved for the command bar')
  assert.equal(validateRoutePrefix('/task', ROUTES), '/task is reserved for the command bar')
})

test('validateRoutePrefix refuses a duplicate, but not the route being edited', () => {
  assert.equal(validateRoutePrefix('/I', ROUTES), '/I is already used by another route')
  assert.equal(validateRoutePrefix('/i', ROUTES, 'ideas'), null)
  assert.equal(validateRoutePrefix('/q', ROUTES, 'ideas'), '/q is already used by another route')
})

test('parseRoutePrefix still matches the longest prefix followed by a space', () => {
  const withLong = [...ROUTES, route('idea-long', '/idea')]
  assert.equal(parseRoutePrefix('/idea film', withLong).route.id, 'idea-long')
  assert.equal(parseRoutePrefix('/i film', withLong).content, 'film')
  assert.equal(parseRoutePrefix('/ifilm', withLong).route, null)
})
