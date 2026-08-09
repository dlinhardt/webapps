import {
  type AbsolutePath,
  type AsyncReadable,
  defineStoreExtension,
  type GetOptions,
  type RangeQuery,
} from 'zarrita'

type ReadResult = Promise<Uint8Array | undefined>

function rangeKey(path: AbsolutePath, range: RangeQuery): string {
  if ('suffixLength' in range) return `${path}\0suffix:${range.suffixLength}`
  return `${path}\0range:${range.offset}:${range.length}`
}

/**
 * Coalesce concurrent reads for the same native Zarr key. Completed reads are
 * deliberately forgotten: the outer byte cache owns durable retention, while
 * this layer only closes the window where overlapping virtual bricks all miss
 * that cache before the first native request settles.
 */
export const withInflightReadDeduplication = defineStoreExtension(
  (store: AsyncReadable) => {
    const pending = new Map<string, ReadResult>()
    const share = (key: string, read: () => ReadResult): ReadResult => {
      const existing = pending.get(key)
      if (existing) return existing
      const next = read()
      pending.set(key, next)
      const cleanup = (): void => {
        if (pending.get(key) === next) pending.delete(key)
      }
      next.then(cleanup, cleanup)
      return next
    }
    const getRange = store.getRange?.bind(store)
    return {
      get(path: AbsolutePath, options?: GetOptions): ReadResult {
        if (options?.signal) return store.get(path, options)
        return share(`get:${path}`, () => store.get(path, options))
      },
      ...(getRange && {
        getRange(
          path: AbsolutePath,
          range: RangeQuery,
          options?: GetOptions,
        ): ReadResult {
          if (options?.signal) return getRange(path, range, options)
          return share(rangeKey(path, range), () =>
            getRange(path, range, options),
          )
        },
      }),
    }
  },
)
