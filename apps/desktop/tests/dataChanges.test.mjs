import test from 'node:test'
import assert from 'node:assert/strict'
import { dispatchDataChanges, subscribeDataChanges } from '../src/lib/dataChanges.ts'
test('delivers once to each matching subscriber and removes unsubscribed listeners', () => {
  let a = 0, b = 0, other = 0
  const stop = subscribeDataChanges('tasks', () => a++)
  const stopB = subscribeDataChanges('tasks', () => b++)
  const stopOther = subscribeDataChanges('captures', () => other++)
  dispatchDataChanges(['tasks', 'tasks'])
  assert.deepEqual([a, b, other], [1, 1, 0])
  stop()
  dispatchDataChanges(['tasks', 'captures'])
  assert.deepEqual([a, b, other], [1, 2, 1])
  stopB(); stopOther()
})
test('a failing listener does not prevent other views refreshing', () => {
  let called = false
  const first = subscribeDataChanges('labels', () => { throw new Error('test') })
  const second = subscribeDataChanges('labels', () => { called = true })
  dispatchDataChanges(['labels'])
  assert.equal(called, true)
  first(); second()
})
