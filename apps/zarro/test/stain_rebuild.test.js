import assert from 'node:assert/strict'
import test from 'node:test'
import { refocusLoadedStainVolumes } from '../src/stain_rebuild.ts'

test('aborts all obsolete stain reads before scheduling replacement plans', () => {
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

  refocusLoadedStainVolumes([request('first', 4), request('second', 4)])

  assert.deepEqual(order, [
    'renew:first',
    'renew:second',
    'detail:first:4',
    'focus:first',
    'detail:second:4',
    'focus:second',
  ])
})
