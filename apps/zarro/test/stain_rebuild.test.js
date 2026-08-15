import assert from 'node:assert/strict'
import test from 'node:test'
import { refocusLoadedStainVolumes } from '../src/stain_rebuild.ts'

test('aborts all obsolete stain reads before scheduling replacement plans', async () => {
  const order = []
  const request = (name, level) => ({
    readSession: { renew: () => order.push(`renew:${name}`) },
    controller: {
      setMaxDetail: (value) => order.push(`detail:${name}:${value}`),
      setFocus: () => order.push(`focus:${name}`),
    },
    targetLevel: level,
    focus: [0.5, 0.5, 0.5],
    bounds: [],
  })

  await refocusLoadedStainVolumes(
    [request('first', 4), request('second', 4)],
    async () => {},
  )

  assert.deepEqual(order, [
    'renew:first',
    'renew:second',
    'detail:first:4',
    'focus:first',
    'detail:second:4',
    'focus:second',
  ])
})

test('settles each stain plan swap before starting the next one', async () => {
  const order = []
  const settle = new Map()
  const request = (name) => ({
    readSession: { renew: () => order.push(`renew:${name}`) },
    controller: {
      name,
      currentPlan: `${name}:old`,
      setMaxDetail: () => order.push(`detail:${name}`),
      setFocus: () => order.push(`focus:${name}`),
    },
    targetLevel: 3,
    focus: [0.5, 0.5, 0.5],
    bounds: [],
  })
  const first = request('first')
  const second = request('second')

  const refocus = refocusLoadedStainVolumes(
    [first, second],
    (controller, previousPlan) => {
      order.push(`wait:${controller.name}:${previousPlan}`)
      return new Promise((resolve) => settle.set(controller.name, resolve))
    },
  )

  await Promise.resolve()
  assert.deepEqual(order, [
    'renew:first',
    'renew:second',
    'detail:first',
    'focus:first',
    'wait:first:first:old',
  ])

  settle.get('first')()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(order, [
    'renew:first',
    'renew:second',
    'detail:first',
    'focus:first',
    'wait:first:first:old',
    'detail:second',
    'focus:second',
    'wait:second:second:old',
  ])

  settle.get('second')()
  await refocus
})
