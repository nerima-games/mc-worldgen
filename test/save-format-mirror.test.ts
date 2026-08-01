/**
 * The mc-save mirror is pinned against mc-save's documented shape.
 *
 * Same defence and the same reasoning as `test/kernel-mirror.test.ts`:
 * `domain/save-format-port.ts` promises that deleting it and repointing every
 * import at `@nerima-games/mc-save` will typecheck, and nothing but a test can
 * enforce that promise. mc-save's declarations are RESTATED here rather than
 * imported, because mc-save is not published — which is the same reason the
 * mirror exists at all. When it is published, each restatement becomes an
 * `import type` and every assertion below keeps its meaning unchanged.
 *
 * ---------------------------------------------------------------------------
 * THIS TEST IS THE WEAKER HALF, AND SAYING SO IS THE POINT
 * ---------------------------------------------------------------------------
 *
 * `domain/kernel-vocabulary.ts`'s header states the limit that applies here word
 * for word: 「this file's correctness is checked by a test that this repository
 * could edit in the same commit that breaks it」. Everything below is a
 * transcription checked against another transcription. Both can be wrong
 * together and this file will be green.
 *
 * The structural half is mc-dev-meta's `pnpm check:mirrors`, which carries a
 * `MIRROR_SPECS` row for `mc-worldgen/domain/save-format-port.ts` and compares
 * it against mc-save's real barrel and real `api-lock.md` in the one build where
 * both packages exist. That gate is the reason the LIST OF EXPORTS is pinned at
 * the bottom of this file: `compareValues` reports any mirrored symbol that
 * mc-save's barrel does not publish, so the export list is the surface the two
 * gates meet on, and a name added here without a counterpart there fails from
 * outside even though everything in this repository agrees with itself.
 *
 * ---------------------------------------------------------------------------
 * What is deliberately NOT pinned
 * ---------------------------------------------------------------------------
 *
 * The symbols the mirror declines to carry — `StoragePort`, `saveTo`,
 * `loadFrom`, the registry, the IndexedDB adapter. A mirror is minimal by
 * design, and `mirror-contract.ts` records that 「a source export absent from
 * the mirror is correct, not a finding」. Asserting their ABSENCE would freeze a
 * decision that is expected to change the day `ChunkStore.unload` persists.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import {
  decodeSave,
  defineFormat,
  encodeSave,
  FIRST_VERSION,
  MigrationError,
  SaveDecodeError,
  saveEnvelope,
  SaveEnvelopeSchema,
  validateMigrationChain,
  type Migration,
  type SaveEnvelope,
  type SaveFormat,
} from '../src/domain/save-format-port'

/** A format whose encoded form differs from its decoded form, so a round trip can fail. */
const ProbeSchema = Schema.Struct({ label: Schema.String, at: Schema.DateFromNumber })
type Probe = Schema.Schema.Type<typeof ProbeSchema>

const PROBE_FORMAT = defineFormat({ name: 'mc-worldgen/test/probe', version: 1, schema: ProbeSchema })

describe('the envelope matches mc-save/domain/envelope.ts', () => {
  /** mc-save's `SaveEnvelope`, restated from `mc-save/domain/envelope.ts:53-57`. */
  type SaveEnvelopeRestated = {
    readonly format: string
    readonly version: number
    readonly payload: unknown
  }

  it('SF-1: the envelope shape agrees in both directions', () => {
    const fromMirror: SaveEnvelope = saveEnvelope('a', 1, { any: 'thing' })
    const asRestated: SaveEnvelopeRestated = fromMirror
    const backAgain: SaveEnvelope = asRestated

    expect(backAgain).toStrictEqual({ format: 'a', version: 1, payload: { any: 'thing' } })
  })

  it('SF-2: FIRST_VERSION is 1 — a scalar, and therefore compared for real by check:mirrors', () => {
    // `mirror-contract.ts` reduces a number export to a `Scalar` observation and
    // compares the rendered value against mc-save's. This is the one kind of
    // claim in this file that a drift cannot survive.
    expect(FIRST_VERSION).toBe(1)
  })

  it('SF-3: SaveEnvelopeSchema rejects version 0 and a blank format name', () => {
    // The refinements, not just the field names: `Schema.minLength(1)` on the
    // name and `int() + greaterThanOrEqualTo(FIRST_VERSION)` on the version.
    // A mirror that kept the fields and dropped the refinements typechecks.
    expect(Schema.is(SaveEnvelopeSchema)({ format: 'a', version: 1, payload: null })).toBe(true)
    expect(Schema.is(SaveEnvelopeSchema)({ format: '', version: 1, payload: null })).toBe(false)
    expect(Schema.is(SaveEnvelopeSchema)({ format: 'a', version: 0, payload: null })).toBe(false)
    expect(Schema.is(SaveEnvelopeSchema)({ format: 'a', version: 1.5, payload: null })).toBe(false)
  })
})

describe('the format vocabulary matches mc-save/domain/format.ts', () => {
  /** mc-save's `Migration`, restated from `mc-save/domain/format.ts:45-58`. */
  type MigrationRestated = {
    readonly from: number
    readonly describe: string
    readonly migrate: (payload: unknown) => Effect.Effect<unknown, string>
  }

  /** mc-save's `SaveFormat`, restated from `mc-save/domain/format.ts:60-65`. */
  type SaveFormatRestated<A, I = A> = {
    readonly name: string
    readonly version: number
    readonly schema: Schema.Schema<A, I>
    readonly migrations: ReadonlyArray<Migration>
  }

  it('SF-4: the Migration shape agrees in both directions', () => {
    const fromMirror: Migration = {
      from: 1,
      describe: 'a step',
      migrate: (payload) => Effect.succeed(payload),
    }
    const asRestated: MigrationRestated = fromMirror
    const backAgain: Migration = asRestated

    expect(backAgain.from).toBe(1)
    expect(Effect.runSync(backAgain.migrate('x'))).toBe('x')
  })

  it('SF-5: the SaveFormat shape agrees in both directions, INCLUDING the `I = A` default', () => {
    // The default is load-bearing: mc-save writes `SaveFormat<A, I = A>`, so
    // `SaveFormat<Probe>` is a legal one-parameter spelling. A mirror declaring
    // `SaveFormat<A, I>` compiles everywhere in this repository — which uses
    // two parameters — and breaks the first caller that uses one.
    const fromMirror: SaveFormat<Probe, Schema.Schema.Encoded<typeof ProbeSchema>> = PROBE_FORMAT
    const asRestated: SaveFormatRestated<Probe, Schema.Schema.Encoded<typeof ProbeSchema>> = fromMirror
    const backAgain: SaveFormat<Probe, Schema.Schema.Encoded<typeof ProbeSchema>> = asRestated

    const singleParameter: SaveFormat<SaveEnvelope> = {
      name: 'one-parameter',
      version: 1,
      schema: SaveEnvelopeSchema,
      migrations: [],
    }

    expect(backAgain.name).toBe('mc-worldgen/test/probe')
    expect(singleParameter.version).toBe(1)
  })

  it('SF-6: defineFormat sorts the chain and defaults `migrations` to empty', () => {
    const step = (from: number): Migration => ({
      from,
      describe: `v${String(from)}`,
      migrate: (payload) => Effect.succeed(payload),
    })

    const format = defineFormat({
      name: 'mc-worldgen/test/sorted',
      version: 4,
      schema: Schema.String,
      migrations: [step(3), step(1), step(2)],
    })

    expect(format.migrations.map((migration) => migration.from)).toStrictEqual([1, 2, 3])
    expect(PROBE_FORMAT.migrations).toStrictEqual([])
  })

  it('SF-7: defineFormat THROWS on a gapped chain, at definition time', () => {
    // Not a returned error. mc-save's argument is that a gap 「is not a runtime
    // condition to be handled — it is a build that must not ship」, and a mirror
    // that softened it to an `Either` would let `domain/chunk-format.ts` be
    // written against a discipline that only exists in another repository.
    expect(() =>
      defineFormat({ name: 'mc-worldgen/test/gapped', version: 3, schema: Schema.String, migrations: [] }),
    ).toThrow(/is not well-formed/u)
  })

  it('SF-8: validateMigrationChain returns the problems as DATA, with mc-save’s wording', () => {
    const problems = validateMigrationChain({
      name: 'mc-worldgen/test/gapped',
      version: 3,
      migrations: [],
    })

    expect(problems).toHaveLength(2)
    expect(problems[0]).toContain('no migration from version 1 to 2')
    expect(problems[1]).toContain('no migration from version 2 to 3')
    expect(problems[0]).toContain('saves written by that build become unreadable')
  })

  it('SF-9: validateMigrationChain refuses a version below FIRST_VERSION and stops there', () => {
    // The early `return` matters: a version of 0 makes every later rule
    // meaningless, and mc-save reports one problem rather than a cascade.
    const problems = validateMigrationChain({ name: 'x', version: 0, migrations: [] })

    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('version must be an integer >= 1')
  })

  it('SF-10: a duplicated `from` is reported as a non-linear chain', () => {
    const step = (from: number): Migration => ({
      from,
      describe: 'd',
      migrate: (payload) => Effect.succeed(payload),
    })
    const problems = validateMigrationChain({ name: 'x', version: 2, migrations: [step(1), step(1)] })

    expect(problems.some((problem) => problem.includes('a chain must be linear'))).toBe(true)
  })
})

describe('encode / decode behaviour matches mc-save', () => {
  it.effect('SF-11: encodeSave stamps the name and version and emits the ENCODED shape', () =>
    Effect.gen(function* () {
      const envelope = yield* encodeSave(PROBE_FORMAT, { label: 'x', at: new Date(1_700_000_000_000) })

      expect(envelope.format).toBe('mc-worldgen/test/probe')
      expect(envelope.version).toBe(1)
      // A number, not a Date — the wire shape. mc-save's
      // `test/format-roundtrip.test.ts` makes the same assertion.
      expect(envelope.payload).toStrictEqual({ label: 'x', at: 1_700_000_000_000 })
    }),
  )

  it.effect('SF-12: decodeSave checks the NAME before the version', () =>
    Effect.gen(function* () {
      // The ordering is observable and worth pinning: an envelope that is both
      // foreign AND from the future must report the foreignness, because
      // "belongs to another format" is actionable and "needs a newer build" is
      // a lie about a file this build was never going to read.
      const both = saveEnvelope('some-other-format', 99, { label: 'x', at: 0 })
      const error = yield* Effect.flip(decodeSave(PROBE_FORMAT, both))

      expect(error._tag).toBe('SaveDecodeError')
      expect(error.message).toContain('some-other-format')
      expect(error.message).not.toContain('newer build')
    }),
  )

  it.effect('SF-13: a future envelope is refused with mc-save’s exact reasoning', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decodeSave(PROBE_FORMAT, saveEnvelope('mc-worldgen/test/probe', 2, { label: 'x', at: 0 })),
      )

      expect(error.message).toContain('written by a newer build (v2 > v1)')
      expect(error.message).toContain('must not be offered for deletion')
    }),
  )
})

describe('the error types match mc-save/domain/errors.ts', () => {
  it('SF-14: SaveDecodeError carries mc-save’s fields, tag and message format', () => {
    const error = new SaveDecodeError({ format: 'f', version: 7, reason: 'because' })

    expect(error._tag).toBe('SaveDecodeError')
    expect(error.message).toBe('save format "f" v7 failed to decode: because')
  })

  it('SF-15: MigrationError carries mc-save’s fields, tag and message format', () => {
    const error = new MigrationError({ format: 'f', fromVersion: 1, toVersion: 2, reason: 'because' })

    expect(error._tag).toBe('MigrationError')
    expect(error.message).toBe('migration 1 → 2 of save format "f" failed: because')
  })

  it('SF-16: the two are distinguishable by tag, which is the reason they are separate types', () => {
    // mc-save's errors.ts argues that the CALLER's correct response differs —
    // refuse-and-warn against report-a-bug — and a mirror that collapsed them
    // would rebuild the reference's single `StorageError`.
    const decode: { readonly _tag: string } = new SaveDecodeError({ format: 'f', version: 1, reason: 'r' })
    const migrate: { readonly _tag: string } = new MigrationError({
      format: 'f',
      fromVersion: 1,
      toVersion: 2,
      reason: 'r',
    })

    expect(decode._tag).not.toBe(migrate._tag)
  })
})

describe('the mirror’s SURFACE is pinned, because that is what repoint day replaces', () => {
  it('SF-17: the exported names are exactly these, and every one must be on mc-save’s barrel', async () => {
    // Each name here is a claim that `@nerima-games/mc-save` exports it under
    // this spelling. mc-dev-meta's `check:mirrors` is what verifies the claim;
    // this test is what makes ADDING a name a deliberate act rather than a
    // side effect of an import.
    //
    // `isFromFuture` and `migrateToCurrent` are transcribed but NOT exported,
    // and their absence from this list is the assertion of that.
    const module: Record<string, unknown> = await import('../src/domain/save-format-port')

    expect(Object.keys(module).sort()).toStrictEqual([
      'FIRST_VERSION',
      'MigrationError',
      'SaveDecodeError',
      'SaveEnvelopeSchema',
      'decodeSave',
      'defineFormat',
      'encodeSave',
      'saveEnvelope',
      'validateMigrationChain',
    ])
  })
})
