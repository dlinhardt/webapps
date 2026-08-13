import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addStainLayer,
  parseStainLayers,
  serializeStainLayers,
  updateStainLayer,
} from '../src/stain_layers.ts'

test('keeps translated chunk stores together within a stain layer', () => {
  const result = addStainLayer([], {
    name: 'LEC',
    source: 'dandi',
    storeUrls: ['https://example.test/chunk-1/', 'https://example.test/chunk-2/'],
  })

  assert.equal(result.added, true)
  assert.equal(result.layer.name, 'LEC')
  assert.deepEqual(result.layer.storeUrls, [
    'https://example.test/chunk-1/',
    'https://example.test/chunk-2/',
  ])
})

test('deduplicates the same stain independently of chunk order', () => {
  const first = addStainLayer([], {
    name: 'LEC',
    source: 'dandi',
    storeUrls: ['chunk-1', 'chunk-2'],
  })
  const second = addStainLayer(first.layers, {
    name: 'LEC duplicate',
    source: 'dandi',
    storeUrls: ['chunk-2', 'chunk-1'],
  })

  assert.equal(second.added, false)
  assert.equal(second.layers.length, 1)
  assert.equal(second.layer.id, first.layer.id)
})

test('updates and removes a stain without changing the other layers', () => {
  const first = addStainLayer([], {
    name: 'LEC',
    source: 'dandi',
    storeUrls: ['lec'],
  })
  const second = addStainLayer(first.layers, {
    name: 'DAPI',
    source: 'dandi',
    storeUrls: ['dapi'],
  })
  const renamed = updateStainLayer(second.layers, first.layer.id, {
    name: 'LEC corrected',
    storeUrls: ['lec', 'lec-2'],
  })
  const removed = updateStainLayer(renamed, second.layer.id, {
    name: 'DAPI',
    storeUrls: [],
  })

  assert.deepEqual(removed.map(({ name }) => name), ['LEC corrected'])
  assert.deepEqual(removed[0].storeUrls, ['lec', 'lec-2'])
})

test('round-trips layers through the share-link payload', () => {
  let layers = addStainLayer([], {
    name: 'LEC',
    source: 'dandi',
    storeUrls: ['lec-1', 'lec-2'],
  }).layers
  layers = addStainLayer(layers, {
    name: 'DAPI',
    source: 'custom',
    storeUrls: ['dapi'],
  }).layers

  const restored = parseStainLayers(serializeStainLayers(layers))
  assert.deepEqual(restored.map(({ id }) => id), layers.map(({ id }) => id))
  assert.deepEqual(
    restored.map(({ name, source, storeUrls }) => ({
      name,
      source,
      storeUrls,
    })),
    layers.map(({ name, source, storeUrls }) => ({
      name,
      source,
      storeUrls,
    })),
  )
  assert.deepEqual(parseStainLayers('not json'), [])
})

test('ignores removed opacity values in old share links', () => {
  const oldPayload = JSON.stringify([{
    id: 'stain-old',
    name: 'Old stain',
    source: 'dandi',
    storeUrls: ['old'],
    opacity: 0.4,
  }])
  const restored = parseStainLayers(oldPayload)
  assert.deepEqual(restored, [{
    id: 'stain-old',
    name: 'Old stain',
    source: 'dandi',
    storeUrls: ['old'],
  }])
  assert.equal(serializeStainLayers(restored).includes('opacity'), false)
})
