import type { ChunkKey } from '@nerima-games/mc-kernel'

type Entry = {
  readonly key: ChunkKey
  previous: Entry | null
  next: Entry | null
}

export type ChunkStoreLru = {
  readonly add: (key: ChunkKey) => void
  readonly clear: () => void
  readonly delete: (key: ChunkKey) => void
  readonly oldest: () => ChunkKey | null
  readonly size: () => number
  readonly touch: (key: ChunkKey) => void
}

/** A mutable, O(1) least-recently-used ordering owned by one ChunkStore. */
export const makeChunkStoreLru = (): ChunkStoreLru => {
  const entries = new Map<ChunkKey, Entry>()
  let oldest: Entry | null = null
  let newest: Entry | null = null

  const detach = (entry: Entry): void => {
    if (entry.previous) {
      entry.previous.next = entry.next
    } else {
      oldest = entry.next
    }

    if (entry.next) {
      entry.next.previous = entry.previous
    } else {
      newest = entry.previous
    }

    entry.previous = null
    entry.next = null
  }

  const append = (entry: Entry): void => {
    entry.previous = newest
    entry.next = null

    if (newest) {
      newest.next = entry
    } else {
      oldest = entry
    }

    newest = entry
  }

  const touch = (key: ChunkKey): void => {
    const entry = entries.get(key)
    if (!entry || entry === newest) {
      return
    }
    detach(entry)
    append(entry)
  }

  return {
    add: (key) => {
      const existing = entries.get(key)
      if (existing) {
        touch(key)
        return
      }

      const entry: Entry = { key, next: null, previous: null }
      entries.set(key, entry)
      append(entry)
    },

    clear: () => {
      entries.clear()
      oldest = null
      newest = null
    },

    delete: (key) => {
      const entry = entries.get(key)
      if (!entry) {
        return
      }
      detach(entry)
      entries.delete(key)
    },

    oldest: () => oldest?.key ?? null,
    size: () => entries.size,
    touch,
  }
}
