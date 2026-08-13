import assert from 'node:assert/strict'
import test from 'node:test'
import { AbortableTaskPool } from '../src/abortable_task_pool.ts'

test('runs at the configured concurrency and cancels obsolete queued work', async () => {
  const pool = new AbortableTaskPool(2)
  const activeController = new AbortController()
  const obsoleteController = new AbortController()
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  let active = 0
  let maximumActive = 0
  const started = []
  const run = (name, signal = activeController.signal) =>
    pool.run(signal, async () => {
      started.push(name)
      active++
      maximumActive = Math.max(maximumActive, active)
      await gate
      active--
      return name
    })

  const first = run('first')
  const second = run('second')
  const obsolete = run('obsolete', obsoleteController.signal)
  await Promise.resolve()
  obsoleteController.abort(new DOMException('superseded', 'AbortError'))

  await assert.rejects(obsolete, { name: 'AbortError' })
  assert.deepEqual(started, ['first', 'second'])
  assert.equal(maximumActive, 2)
  release()
  assert.equal(await first, 'first')
  assert.equal(await second, 'second')
})

test('releases an active slot immediately when obsolete work is aborted', async () => {
  const pool = new AbortableTaskPool(1)
  const obsoleteController = new AbortController()
  const never = new Promise(() => {})
  const started = []

  const obsolete = pool.run(obsoleteController.signal, async () => {
    started.push('obsolete')
    await never
  })
  await Promise.resolve()

  const replacement = pool.run(new AbortController().signal, async () => {
    started.push('replacement')
    return 'ready'
  })
  obsoleteController.abort(new DOMException('superseded', 'AbortError'))

  await assert.rejects(obsolete, { name: 'AbortError' })
  assert.equal(await replacement, 'ready')
  assert.deepEqual(started, ['obsolete', 'replacement'])
})
