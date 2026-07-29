import { describe, expect, it } from '@effect/vitest'
import { CHUNK_FORMAT as DOMAIN_CHUNK_FORMAT } from '../domain/chunk-format'
import * as worldgen from '../index'

describe('public API surface', () => {
  it('publishes the chunk persistence format from the package root', () => {
    expect(worldgen.CHUNK_FORMAT).toBe(DOMAIN_CHUNK_FORMAT)
  })
})
