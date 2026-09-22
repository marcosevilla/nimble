import test from 'node:test'
import assert from 'node:assert/strict'
import { visibleTreeKeys, pickRovingKey } from '../src/lib/docsTree.ts'

const vaultRoot = {
  path: '',
  children: [
    { path: 'inbox', children: [{ path: 'inbox/old', children: [], notes: [{ path: 'inbox/old/a.md' }] }], notes: [{ path: 'inbox/b.md' }] },
  ],
  notes: [{ path: 'root.md' }],
}

const base = {
  folders: [{ id: 'f1' }, { id: 'f2' }],
  docsByFolder: { f1: [{ id: 'd1' }, { id: 'd2' }], f2: [{ id: 'd3' }] },
  unfiled: [{ id: 'u1' }],
  expandedFolders: new Set(['f1']),
  vaultRoot,
  vaultExpanded: false,
  expandedVaultFolders: new Set(),
}

test('keys follow render order: folders and their open docs, unfiled, then the vault header', () => {
  assert.deepEqual(visibleTreeKeys(base), ['folder:f1', 'doc:d1', 'doc:d2', 'folder:f2', 'doc:u1', 'vault'])
})

test('an open vault lists subfolders before notes, recursing only into open folders', () => {
  const keys = visibleTreeKeys({ ...base, vaultExpanded: true, expandedVaultFolders: new Set(['inbox']) })
  assert.deepEqual(keys.slice(keys.indexOf('vault')), ['vault', 'vault:inbox', 'vault:inbox/old', 'note:inbox/b.md', 'note:root.md'])
})

test('no vault notes → no vault header', () => {
  assert.ok(!visibleTreeKeys({ ...base, vaultRoot: null }).includes('vault'))
})

test('roving key prefers the last-focused row, then the selection, then the first row — skipping hidden ones', () => {
  const visible = ['folder:f1', 'doc:d1', 'vault']
  assert.equal(pickRovingKey(visible, 'doc:d1', 'vault'), 'doc:d1')
  assert.equal(pickRovingKey(visible, 'doc:gone', 'vault'), 'vault')
  assert.equal(pickRovingKey(visible, null, 'note:hidden.md'), 'folder:f1', 'selection inside a collapsed folder')
  assert.equal(pickRovingKey([], 'x'), null)
})
