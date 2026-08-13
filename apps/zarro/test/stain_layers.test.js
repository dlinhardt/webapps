import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addStainLayer,
  selectExclusiveStainLayer,
  parseStainLayers,
  serializeStainLayers,
  setStainLayerOpacity,
  stainLayerPayloadHasOpacity,
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
  assert.equal(result.layer.opacity, 1)
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

test('switches layers exclusively and clamps manual opacity', () => {
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

  assert.deepEqual(second.layers.map(({ opacity }) => opacity), [1, 0])
  const selected = selectExclusiveStainLayer(second.layers, second.layer.id)
  assert.deepEqual(selected.map(({ opacity }) => opacity), [0, 1])
  const blended = setStainLayerOpacity(selected, first.layer.id, 0.35)
  assert.deepEqual(blended.map(({ opacity }) => opacity), [0.35, 1])
  assert.equal(setStainLayerOpacity(blended, first.layer.id, 2)[0].opacity, 1)
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
    restored.map(({ name, source, storeUrls, opacity }) => ({
      name,
      source,
      storeUrls,
      opacity,
    })),
    layers.map(({ name, source, storeUrls, opacity }) => ({
      name,
      source,
      storeUrls,
      opacity,
    })),
  )
  assert.deepEqual(parseStainLayers('not json'), [])
})

test('distinguishes legacy layer links that predate opacity', () => {
  const legacy = JSON.stringify([{
    id: 'stain-legacy',
    name: 'Legacy stain',
    source: 'dandi',
    storeUrls: ['legacy'],
  }])
  const current = JSON.stringify([{
    id: 'stain-current',
    name: 'Current stain',
    source: 'dandi',
    storeUrls: ['current'],
    opacity: 0.4,
  }])

  assert.equal(stainLayerPayloadHasOpacity(legacy), false)
  assert.equal(stainLayerPayloadHasOpacity(current), true)
  assert.equal(stainLayerPayloadHasOpacity('not json'), false)
})
