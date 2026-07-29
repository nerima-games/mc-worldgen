/**
 * PROVISIONAL LOCAL MIRROR OF `@nerima-games/mc-save`'s FORMAT TOOLKIT.
 *
 * ---------------------------------------------------------------------------
 * This module is scheduled for deletion. Do not build on it.
 * ---------------------------------------------------------------------------
 *
 * mc-save is a legitimate `dependencies` edge for this repository — plan.md
 * §3.7 hands mc-worldgen the chunk format in as many words (「永続化は mc-save
 * のツールキットでチャンクフォーマットを定義」) and `pnpm check:deps` already
 * lists `@nerima-games/mc-save` among the allowed direct dependencies. So this
 * mirror is not standing in for a forbidden import, only for an unpublished
 * one: plan.md §6 Step 3 publishes bottom-up, nothing is on GitHub Packages
 * yet, and `check:deps` would reject an import of a package absent from
 * `package.json#dependencies`.
 *
 * WHEN mc-save IS PUBLISHED:
 *   1. add `@nerima-games/mc-save` to `package.json#dependencies`;
 *   2. delete this file;
 *   3. repoint every `from './save-format-port'` at `'@nerima-games/mc-save'`.
 * If step 3 does not typecheck, this file has drifted and the drift is the bug.
 * `test/save-format-mirror.test.ts` restates mc-save's shapes and pins them, and
 * mc-dev-meta's `MIRROR_SPECS` carries a row for this file so that the
 * comparison also happens from OUTSIDE this repository, in the one build where
 * both packages exist. The inside test alone would be a test this repository
 * could edit in the same commit that breaks it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL, WHEN docs/responsibility.md SAID IT COULD NOT
 * ---------------------------------------------------------------------------
 *
 * §1-5 recorded the chunk format as 「⬜ publish 待ち」 and gave the reason as
 * 「import できない理由は `domain/kernel-vocabulary.ts` と同じ」. That sentence
 * is true and is the refutation of its own conclusion: `kernel-vocabulary.ts`
 * is not a file that waited for a publish, it is the file that made waiting
 * unnecessary. Five repositories carry one, three carry a `frame-contract.ts`,
 * and mx-gameplay carries four more. The organisation's answer to "the package
 * is not published" has been "mirror the contract" for as long as there have
 * been contracts to mirror.
 *
 * So the blocker was never the publish. It was that nobody had written this
 * file.
 *
 * ---------------------------------------------------------------------------
 * The mirror is MINIMAL, and here is the boundary it keeps
 * ---------------------------------------------------------------------------
 *
 * Transcribed: the format vocabulary — how a versioned format is DEFINED, and
 * the two functions that turn a value into an envelope and back. That is the
 * whole of what plan.md §3.7 assigns here.
 *
 * NOT transcribed, deliberately:
 *
 *   `StoragePort`, `SaveKey`, `saveTo`, `loadFrom`   The MEDIUM. Choosing where
 *       bytes go is not defining what they mean, and docs/responsibility.md §2
 *       is explicit that 「永続化の機構」 is mc-save's. `ChunkStore.unload` will
 *       need these on the day it persists (§5), and that day is when they get
 *       mirrored — by which time mc-save may simply be published.
 *   The registry (`FormatRegistry`, `registerFormat`, ...)   Enumerating every
 *       format a BUILD knows about is a whole-application concern; mc-worldgen
 *       owns one format and does not assemble the build.
 *   `StorageError`, `DuplicateFormatError`   Reachable only through the two
 *       above.
 *   The IndexedDB adapter   A browser is not this repository's business; §5's
 *       THREE-zero principle is the same principle one layer down.
 *
 * `isFromFuture` is transcribed but NOT exported. `decodeSave` needs it and
 * nothing here does; a mirror's surface should be the symbols this repository
 * uses, not every symbol it happens to contain.
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS RENAMED, AND THAT IS A RULE RATHER THAN AN OBSERVATION
 * ---------------------------------------------------------------------------
 *
 * A mirror that renames a symbol typechecks, passes every local test, and
 * yields a name that does not exist on repoint day. `mx-gameplay`'s
 * `inventory-port.ts` header records the same rule after the organisation paid
 * for it. Every declaration below carries mc-save's spelling exactly, including
 * `SaveFormat`'s `I = A` default and the argument order of every function.
 *
 * There was no collision to resolve: `SaveFormat`, `Migration`, `defineFormat`,
 * `encodeSave`, `decodeSave`, `SaveEnvelope`, `FIRST_VERSION`, `saveEnvelope`,
 * `validateMigrationChain`, `SaveDecodeError` and `MigrationError` were all
 * unused in this repository before this file. Had there been one, the rule is
 * that THE LOCAL NAME MOVES.
 *
 * Bodies are transcribed too, not just signatures. `defineFormat` THROWS on a
 * malformed chain and `decodeSave` REFUSES a foreign envelope before it refuses
 * a corrupt one; a signature-only mirror would let `./chunk-format` be written
 * against behaviour that only exists in another repository, and the first time
 * anyone found out would be the repoint.
 */
import { Data, Effect, Schema } from 'effect'

// ---------------------------------------------------------------------------
// mc-save/domain/errors.ts
// ---------------------------------------------------------------------------

/**
 * The bytes came back but do not mean what this build expects.
 *
 * `version` is the version recorded in the envelope, which is the single most
 * useful thing to put in a bug report and the thing the reference implementation
 * threw away.
 */
export class SaveDecodeError extends Data.TaggedError('SaveDecodeError')<{
  readonly format: string
  readonly version: number
  readonly reason: string
  readonly cause?: unknown
}> {
  override get message(): string {
    return `save format "${this.format}" v${String(this.version)} failed to decode: ${this.reason}`
  }
}

/**
 * A migration step exists, ran, and did not produce something the next step (or
 * the final schema) accepts.
 *
 * Distinct from `SaveDecodeError` on purpose: a decode failure usually means a
 * corrupt or foreign file, whereas this always means *our own* migration code is
 * wrong. Conflating them is how a broken migration ships as "some users have
 * corrupt saves".
 */
export class MigrationError extends Data.TaggedError('MigrationError')<{
  readonly format: string
  readonly fromVersion: number
  readonly toVersion: number
  readonly reason: string
  readonly cause?: unknown
}> {
  override get message(): string {
    return (
      `migration ${String(this.fromVersion)} → ${String(this.toVersion)} of save format ` +
      `"${this.format}" failed: ${this.reason}`
    )
  }
}

// ---------------------------------------------------------------------------
// mc-save/domain/envelope.ts
// ---------------------------------------------------------------------------

/**
 * A format version. Positive integers, counting from 1.
 *
 * Deliberately not branded. The version has to survive a JSON/structured-clone
 * round trip through storage written by an older build, so it arrives as a bare
 * number and is validated by `SaveEnvelopeSchema` at the boundary. A brand would
 * imply a guarantee that the value's own provenance cannot support.
 */
export const FIRST_VERSION = 1

/**
 * What is actually handed to `StoragePort`.
 *
 * `payload` is `unknown` on purpose: the envelope is opened before the format
 * is known, and migrations operate on untyped data by nature — a migration from
 * v1 to v2 must accept a shape that no current schema describes.
 */
export type SaveEnvelope = {
  readonly format: string
  readonly version: number
  readonly payload: unknown
}

export const SaveEnvelopeSchema: Schema.Schema<SaveEnvelope> = Schema.Struct({
  format: Schema.String.pipe(Schema.minLength(1)),
  version: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(FIRST_VERSION)),
  payload: Schema.Unknown,
})

export const saveEnvelope = (format: string, version: number, payload: unknown): SaveEnvelope => ({
  format,
  version,
  payload,
})

/**
 * True when the envelope was written by a build newer than this one.
 *
 * NOT EXPORTED HERE, unlike in mc-save: `decodeSave` below is its only caller in
 * this repository. See this file's header on why the mirror's surface is
 * narrower than its contents.
 */
const isFromFuture = (envelope: SaveEnvelope, currentVersion: number): boolean =>
  envelope.version > currentVersion

// ---------------------------------------------------------------------------
// mc-save/domain/format.ts
// ---------------------------------------------------------------------------

/**
 * One step of a migration chain: `from` → `from + 1`.
 *
 * Steps are deliberately single-version rather than arbitrary `from`/`to` pairs.
 * A chain of N-1 single steps is O(N) to write and O(N) to test; a graph of
 * arbitrary jumps is O(N²) and, in practice, is the shape in which the rarely
 * travelled edges rot undetected.
 */
export type Migration = {
  readonly from: number
  /** Human-readable, and used in `MigrationError.reason`. Say what changed and why. */
  readonly describe: string
  /**
   * Transform a v`from` payload into a v`from + 1` payload.
   *
   * The failure channel is a plain message, not a `MigrationError`: a step
   * knows *what* went wrong but not which format it belongs to or which
   * version pair it sits between. `migrateToCurrent` owns that context and
   * fills it in, so a step cannot mislabel itself.
   */
  readonly migrate: (payload: unknown) => Effect.Effect<unknown, string>
}

export type SaveFormat<A, I = A> = {
  readonly name: string
  readonly version: number
  readonly schema: Schema.Schema<A, I>
  readonly migrations: ReadonlyArray<Migration>
}

/**
 * Problems with a format definition, as a list of human-readable strings.
 *
 * Split out from `defineFormat` so that the rules can be unit-tested directly
 * rather than through `expect(() => ...).toThrow()`, which can only ever assert
 * that *something* was wrong.
 */
export const validateMigrationChain = (spec: {
  readonly name: string
  readonly version: number
  readonly migrations: ReadonlyArray<Migration>
}): ReadonlyArray<string> => {
  const problems: Array<string> = []

  if (!Number.isInteger(spec.version) || spec.version < FIRST_VERSION) {
    problems.push(`version must be an integer >= ${String(FIRST_VERSION)}, received ${String(spec.version)}`)
    return problems
  }

  const required = spec.version - FIRST_VERSION
  const seen = new Set<number>()

  for (const migration of spec.migrations) {
    if (!Number.isInteger(migration.from) || migration.from < FIRST_VERSION) {
      problems.push(`migration.from must be an integer >= ${String(FIRST_VERSION)}, received ${String(migration.from)}`)
      continue
    }
    if (migration.from >= spec.version) {
      problems.push(
        `migration ${String(migration.from)} → ${String(migration.from + 1)} would produce a version above the ` +
          `current version ${String(spec.version)}; bump the format version or delete the step`,
      )
      continue
    }
    if (seen.has(migration.from)) {
      problems.push(`two migrations both start at version ${String(migration.from)}; a chain must be linear`)
      continue
    }
    seen.add(migration.from)
  }

  for (let version = FIRST_VERSION; version < spec.version; version += 1) {
    if (!seen.has(version)) {
      problems.push(
        `no migration from version ${String(version)} to ${String(version + 1)}; every version this format has ` +
          'ever had must have a way forward, or saves written by that build become unreadable',
      )
    }
  }

  if (spec.migrations.length > 0 && required === 0) {
    problems.push(`version is ${String(FIRST_VERSION)} but ${String(spec.migrations.length)} migration(s) are declared`)
  }

  return problems
}

/**
 * Define a save format.
 *
 * Throws on an incomplete migration chain, and does so at module-evaluation
 * time rather than when a player with an old save happens to load it. A gap in
 * the chain is not a runtime condition to be handled — it is a build that must
 * not ship. Use `validateMigrationChain` if you want the problems as data.
 */
export const defineFormat = <A, I>(spec: {
  readonly name: string
  readonly version: number
  readonly schema: Schema.Schema<A, I>
  readonly migrations?: ReadonlyArray<Migration>
}): SaveFormat<A, I> => {
  const migrations = spec.migrations ?? []
  const problems = validateMigrationChain({ name: spec.name, version: spec.version, migrations })

  if (problems.length > 0) {
    throw new Error(
      `save format "${spec.name}" is not well-formed:\n` + problems.map((problem) => `  - ${problem}`).join('\n'),
    )
  }

  return {
    name: spec.name,
    version: spec.version,
    schema: spec.schema,
    migrations: [...migrations].sort((left, right) => left.from - right.from),
  }
}

/** Encode a value into an envelope stamped with the format's current version. */
export const encodeSave = <A, I>(
  format: SaveFormat<A, I>,
  value: A,
): Effect.Effect<SaveEnvelope, SaveDecodeError> =>
  Schema.encode(format.schema)(value).pipe(
    Effect.map((encoded) => saveEnvelope(format.name, format.version, encoded)),
    Effect.mapError(
      (cause) =>
        new SaveDecodeError({
          format: format.name,
          version: format.version,
          reason: 'the value does not satisfy the format schema, so it cannot be encoded',
          cause,
        }),
    ),
  )

/**
 * Run the migration chain from `envelope.version` up to `format.version`.
 *
 * NOT EXPORTED HERE, unlike in mc-save: the chunk format is at v1 with an empty
 * chain, so this repository has no step to run and nothing to assert about one.
 * It is transcribed rather than inlined into `decodeSave` so that the day this
 * format gains a v2, the mirror already has the shape and only its export needs
 * adding.
 */
const migrateToCurrent = <A, I>(
  format: SaveFormat<A, I>,
  envelope: SaveEnvelope,
): Effect.Effect<unknown, MigrationError> => {
  const steps = format.migrations.filter((migration) => migration.from >= envelope.version)

  return Effect.reduce(steps, envelope.payload, (payload, migration) =>
    migration.migrate(payload).pipe(
      Effect.mapError(
        (reason) =>
          new MigrationError({
            format: format.name,
            fromVersion: migration.from,
            toVersion: migration.from + 1,
            reason: `${migration.describe} — ${reason}`,
          }),
      ),
    ),
  )
}

/**
 * Open an envelope: reject foreign and future saves, migrate, then decode.
 *
 * The ordering is the whole point. Migration happens on the raw payload, before
 * `Schema` is applied, so a migration is free to see a shape that no current
 * schema can describe. Decoding first — which is what "just add
 * `Schema.optional`" amounts to — restricts every future change to those that
 * the *current* schema can already parse.
 */
export const decodeSave = <A, I>(
  format: SaveFormat<A, I>,
  envelope: SaveEnvelope,
): Effect.Effect<A, SaveDecodeError | MigrationError> =>
  Effect.gen(function* () {
    if (envelope.format !== format.name) {
      return yield* new SaveDecodeError({
        format: format.name,
        version: envelope.version,
        reason: `envelope belongs to format "${envelope.format}", not "${format.name}"`,
      })
    }

    if (isFromFuture(envelope, format.version)) {
      return yield* new SaveDecodeError({
        format: format.name,
        version: envelope.version,
        reason:
          `this save was written by a newer build (v${String(envelope.version)} > v${String(format.version)}). ` +
          'It is not corrupt and must not be offered for deletion — it needs a newer version of the game.',
      })
    }

    const migrated = yield* migrateToCurrent(format, envelope)

    return yield* Schema.decodeUnknown(format.schema)(migrated).pipe(
      Effect.mapError(
        (cause) =>
          new SaveDecodeError({
            format: format.name,
            version: envelope.version,
            reason:
              envelope.version === format.version
                ? 'the payload does not satisfy the current schema'
                : `the payload does not satisfy the current schema after migrating v${String(envelope.version)} → ` +
                  `v${String(format.version)}; the migration chain is probably wrong`,
            cause,
          }),
      ),
    )
  })
