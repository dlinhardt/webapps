export type StainLayerSource = 'dandi' | 'custom'

export interface StainLayer {
  id: string
  name: string
  source: StainLayerSource
  storeUrls: string[]
}

interface SerializedStainLayer {
  id: string
  name: string
  source: StainLayerSource
  storeUrls: string[]
}

function normalizedUrls(storeUrls: readonly string[]): string[] {
  return [...new Set(storeUrls.map((url) => url.trim()).filter(Boolean))]
}

function layerKey(source: StainLayerSource, storeUrls: readonly string[]): string {
  return `${source}\u0000${normalizedUrls(storeUrls).sort().join('\u0000')}`
}

function layerId(
  source: StainLayerSource,
  storeUrls: readonly string[],
  usedIds: ReadonlySet<string>,
): string {
  const input = layerKey(source, storeUrls)
  let hash = 2166136261
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const base = `stain-${(hash >>> 0).toString(36)}`
  let id = base
  let suffix = 2
  while (usedIds.has(id)) id = `${base}-${suffix++}`
  return id
}

export function addStainLayer(
  layers: readonly StainLayer[],
  input: {
    name: string
    source: StainLayerSource
    storeUrls: readonly string[]
  },
): { layers: StainLayer[]; layer: StainLayer; added: boolean } {
  const storeUrls = normalizedUrls(input.storeUrls)
  if (storeUrls.length === 0) throw new Error('A stain layer needs at least one store')
  const key = layerKey(input.source, storeUrls)
  const existing = layers.find(
    (layer) => layerKey(layer.source, layer.storeUrls) === key,
  )
  if (existing) return { layers: [...layers], layer: existing, added: false }

  const layer: StainLayer = {
    id: layerId(input.source, storeUrls, new Set(layers.map(({ id }) => id))),
    name: input.name.trim() || `Stain ${layers.length + 1}`,
    source: input.source,
    storeUrls,
  }
  return { layers: [...layers, layer], layer, added: true }
}

export function updateStainLayer(
  layers: readonly StainLayer[],
  id: string,
  update: { name: string; storeUrls: readonly string[] },
): StainLayer[] {
  const storeUrls = normalizedUrls(update.storeUrls)
  if (storeUrls.length === 0) return layers.filter((layer) => layer.id !== id)
  return layers.map((layer) =>
    layer.id === id
      ? {
          ...layer,
          name: update.name.trim() || layer.name,
          storeUrls,
        }
      : layer,
  )
}

export function serializeStainLayers(layers: readonly StainLayer[]): string {
  const serialized: SerializedStainLayer[] = layers.map(
    ({ id, name, source, storeUrls }) => ({
      id,
      name,
      source,
      storeUrls,
    }),
  )
  return JSON.stringify(serialized)
}

export function parseStainLayers(value: string | null): StainLayer[] {
  if (!value) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  let layers: StainLayer[] = []
  for (const candidate of parsed) {
    if (
      typeof candidate !== 'object' ||
      candidate === null ||
      !('id' in candidate) ||
      typeof candidate.id !== 'string' ||
      !/^stain-[a-z0-9-]+$/.test(candidate.id) ||
      !('name' in candidate) ||
      typeof candidate.name !== 'string' ||
      !('source' in candidate) ||
      (candidate.source !== 'dandi' && candidate.source !== 'custom') ||
      !('storeUrls' in candidate) ||
      !Array.isArray(candidate.storeUrls) ||
      !candidate.storeUrls.every((url: unknown) => typeof url === 'string')
    ) {
      continue
    }
    try {
      const result = addStainLayer(layers, {
        name: candidate.name,
        source: candidate.source,
        storeUrls: candidate.storeUrls,
      })
      if (!result.added) continue
      const id = layers.some((layer) => layer.id === candidate.id)
        ? result.layer.id
        : candidate.id
      layers = result.layers.map((layer) =>
        layer.id === result.layer.id
          ? {
              ...layer,
              id,
            }
          : layer,
      )
    } catch {
      // Ignore empty or otherwise unusable entries in a shared URL.
    }
  }
  return layers
}
