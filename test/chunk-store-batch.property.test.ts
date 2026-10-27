import { Buffer } from 'node:buffer'
import { describe, expect, it } from '@effect/vitest'
import * as fc from 'fast-check'
import { Effect, Result } from 'effect'
import {
  BLOCK,
  CHUNK_HEIGHT,
  CHUNK_SIZE_XZ,
  CHUNK_VOLUME,
  ChunkCapacity,
  ChunkStore,
  ChunkStoreLayer,
  type ChunkBlockEdit,
  type ChunkSource,
} from '../src/index'
import { validatedBlockPosition as blockPosition, validatedChunkCoord as chunkCoord } from './fixtures/validated-inputs'

type Store = Effect.Success<typeof ChunkStore>
type PreparedBatch = Parameters<Store['publish']>[0]
type Position = ChunkBlockEdit['position']
type BlockValue = ChunkBlockEdit['block']

const TEST_CAPACITY = Result.getOrThrow(ChunkCapacity.result(8))
const BLOCKS = [BLOCK.AIR, BLOCK.SAND, BLOCK.DIRT, BLOCK.GRAVEL] as const
const INVALID_BLOCK_VALUES = [-1, 65_536, Number.NaN, Number.POSITIVE_INFINITY]

const CHUNKS = [
  { key: '0,0', coord: chunkCoord(0, 0) },
  { key: '1,0', coord: chunkCoord(1, 0) },
  { key: '0,1', coord: chunkCoord(0, 1) },
] as const

interface Cell {
  readonly chunkKey: string
  readonly x: number
  readonly y: number
  readonly z: number
  readonly localX: number
  readonly localZ: number
  readonly position: Position
}

const cell = (chunkKey: string, cx: number, cz: number, localX: number, y: number, localZ: number): Cell => {
  const x = cx * CHUNK_SIZE_XZ + localX
  const z = cz * CHUNK_SIZE_XZ + localZ
  return { chunkKey, x, y, z, localX, localZ, position: blockPosition(x, y, z) }
}

const CELLS = [
  cell('0,0', 0, 0, 1, 64, 1),
  cell('0,0', 0, 0, 2, 65, 2),
  cell('0,0', 0, 0, 3, 66, 3),
  cell('1,0', 1, 0, 1, 64, 1),
  cell('1,0', 1, 0, 2, 65, 2),
  cell('1,0', 1, 0, 3, 66, 3),
  cell('0,1', 0, 1, 1, 64, 1),
  cell('0,1', 0, 1, 2, 65, 2),
  cell('0,1', 0, 1, 3, 66, 3),
] as const satisfies ReadonlyArray<Cell>

const CELLS_BY_CHUNK = new Map(CHUNKS.map(({ key }) => [key, CELLS.filter((candidate) => candidate.chunkKey === key)]))
const CELLS_A = CELLS.filter((candidate) => candidate.chunkKey === '0,0')
const CELLS_B = CELLS.filter((candidate) => candidate.chunkKey === '1,0')
const CELLS_C = CELLS.filter((candidate) => candidate.chunkKey === '0,1')

const airSource: ChunkSource = (coord) =>
  Effect.sync(() => ({
    coord,
    blocks: new Uint16Array(CHUNK_VOLUME).fill(BLOCK.AIR),
    biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS' as const),
  }))

const freshStore = () => Effect.provide(ChunkStore, ChunkStoreLayer(airSource, TEST_CAPACITY))
const run = <A>(effect: Effect.Effect<A, never>): Promise<A> => Effect.runPromise(effect)

const invalidBlock = (value: number): BlockValue => value as unknown as BlockValue
const invalidBatchInput = (value: unknown): ReadonlyArray<ChunkBlockEdit> => value as ReadonlyArray<ChunkBlockEdit>

const unsafePosition = (x: number, y: number, z: number): Position =>
  ({ ...blockPosition(0, 64, 0), x, y, z }) as unknown as Position

const publicEdit = (position: Position, block: BlockValue): ChunkBlockEdit => ({ position, block })
const validEdit = (target: Cell, block: BlockValue): ChunkBlockEdit => publicEdit(target.position, block)

const arbitraryValidBlock = fc.constantFrom(...BLOCKS)
const arbitraryCell = fc.constantFrom(...CELLS)
const arbitraryInvalidBlock = fc.constantFrom(...INVALID_BLOCK_VALUES)

const arbitraryEdit = fc.oneof(
  fc.tuple(arbitraryCell, arbitraryValidBlock).map(([target, block]) => validEdit(target, block)),
  fc.tuple(arbitraryCell, fc.constantFrom(-1, CHUNK_HEIGHT)).map(([target, y]) =>
    publicEdit(unsafePosition(target.x, y, target.z), BLOCK.SAND),
  ),
  fc.tuple(arbitraryCell, fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)).map(
    ([target, coordinate]) => publicEdit(unsafePosition(coordinate, target.y, target.z), BLOCK.GRAVEL),
  ),
  fc.tuple(arbitraryCell, arbitraryInvalidBlock).map(([target, block]) => validEdit(target, invalidBlock(block))),
)

const blockIndexInModel = (target: Cell): number =>
  target.y + target.localZ * CHUNK_HEIGHT + target.localX * CHUNK_HEIGHT * CHUNK_SIZE_XZ

interface ResidentSnapshot {
  readonly key: string
  readonly blocks: Uint16Array
  readonly biomes: ReadonlyArray<string>
}

const readResidentState = async (store: Store) => {
  const loaded = await run(store.loadedCoords)
  const snapshots = await Promise.all(
    loaded.map(async (coord): Promise<ResidentSnapshot> => {
      const snapshot = await run(store.snapshot(coord))
      if (snapshot === undefined) throw new Error(`loaded chunk ${coord.cx},${coord.cz} has no snapshot`)
      return {
        key: `${coord.cx},${coord.cz}`,
        blocks: new Uint16Array(snapshot.blocks),
        biomes: [...snapshot.biomes],
      }
    }),
  )

  return { loaded: loaded.map(({ cx, cz }) => `${cx},${cz}`), snapshots }
}

const loadModelChunks = async (store: Store): Promise<void> => {
  for (const { coord } of CHUNKS) {
    // oxlint-disable-next-line no-await-in-loop -- Loads mutate one store, so keep residency changes ordered.
    await run(Effect.orDie(store.load(coord)))
  }
}

const blockBuffersEqual = (left: ArrayLike<number>, right: ArrayLike<number>): boolean => {
  const leftCopy = Uint16Array.from(left)
  const rightCopy = Uint16Array.from(right)

  return (
    Buffer.compare(
      Buffer.from(leftCopy.buffer, leftCopy.byteOffset, leftCopy.byteLength),
      Buffer.from(rightCopy.buffer, rightCopy.byteOffset, rightCopy.byteLength),
    ) === 0
  )
}

const expectResidentStateUnchanged = async (
  store: Store,
  before: Awaited<ReturnType<typeof readResidentState>>,
): Promise<void> => {
  const [loaded, residents] = await Promise.all([
    run(store.loadedCoords),
    Promise.all(
      before.snapshots.map(async (previous) => ({
        previous,
        chunk: await run(store.peek(CHUNKS.find(({ key }) => key === previous.key)!.coord)),
      })),
    ),
  ])
  expect(loaded.map(({ cx, cz }) => `${cx},${cz}`)).toStrictEqual(before.loaded)

  for (const { previous, chunk } of residents) {
    if (chunk === undefined) throw new Error(`loaded chunk ${previous.key} is no longer resident`)
    expect(blockBuffersEqual(chunk.blocks, previous.blocks)).toBe(true)
    expect(chunk.biomes).toStrictEqual(previous.biomes)
  }
}

interface ModelEditSpec {
  readonly target: Cell
  readonly selector: number
}

type BatchSpec = ReadonlyArray<ModelEditSpec>

interface ModelState {
  readonly blocks: ReadonlyMap<string, BlockValue>
  readonly epochs: ReadonlyMap<string, number>
}

interface ModelToken {
  readonly edits: ReadonlyArray<{ readonly target: Cell; readonly block: BlockValue }>
  readonly baseEpochs: ReadonlyMap<string, number>
}

const cellKey = (target: Cell): string => `${target.x},${target.y},${target.z}`

const initialModel = (): ModelState => ({
  blocks: new Map(),
  epochs: new Map(CHUNKS.map(({ key }) => [key, 0])),
})

const chooseChangedBlock = (current: BlockValue, selector: number): BlockValue => {
  const choices = [BLOCK.AIR, BLOCK.SAND, BLOCK.DIRT, BLOCK.GRAVEL] as const
  const currentIndex = choices.findIndex((candidate) => candidate === current)
  const step = 1 + (selector % (choices.length - 1))
  return choices[((currentIndex < 0 ? 0 : currentIndex) + step) % choices.length]!
}

const realiseEdits = (state: ModelState, spec: BatchSpec) =>
  spec.map(({ target, selector }) => ({
    target,
    block: chooseChangedBlock(state.blocks.get(cellKey(target)) ?? BLOCK.AIR, selector),
  }))

const prepareModelToken = (
  state: ModelState,
  edits: ReadonlyArray<{ readonly target: Cell; readonly block: BlockValue }>,
): ModelToken => {
  const baseEpochs = new Map<string, number>()
  for (const { target } of edits) {
    if (!baseEpochs.has(target.chunkKey)) baseEpochs.set(target.chunkKey, state.epochs.get(target.chunkKey)!)
  }
  return { edits, baseEpochs }
}

const modelCanPublish = (state: ModelState, token: ModelToken): boolean =>
  [...token.baseEpochs].every(([key, epoch]) => state.epochs.get(key) === epoch)

const publishModel = (state: ModelState, token: ModelToken): ModelState => {
  const blocks = new Map(state.blocks)
  const epochs = new Map(state.epochs)
  for (const { target, block } of token.edits) blocks.set(cellKey(target), block)
  for (const key of token.baseEpochs.keys()) epochs.set(key, epochs.get(key)! + 1)
  return { blocks, epochs }
}

const expectSnapshotsMatchModel = async (store: Store, model: ModelState): Promise<void> => {
  const chunks = await Promise.all(
    CHUNKS.map(async ({ key, coord }) => ({ key, chunk: await run(store.peek(coord)) })),
  )

  for (const { key, chunk } of chunks) {
    if (chunk === undefined) throw new Error(`model chunk ${key} is not resident`)
    for (const target of CELLS_BY_CHUNK.get(key)!) {
      expect(chunk.blocks[blockIndexInModel(target)]).toBe(model.blocks.get(cellKey(target)) ?? BLOCK.AIR)
    }
  }
}

interface InterleavingSchedule {
  readonly batches: ReadonlyArray<BatchSpec>
  readonly prepareOrder: ReadonlyArray<number>
  readonly extraPublishOrder: ReadonlyArray<number>
  readonly extraCutoffs: ReadonlyArray<number>
}

type Command = { readonly _tag: 'Prepare'; readonly batchId: number } | { readonly _tag: 'Publish'; readonly batchId: number }

const specialBatchesArbitrary = fc
  .record({
    first: fc.constantFrom(...CELLS_A),
    shared: fc.constantFrom(...CELLS_B),
    firstSelector: fc.integer({ min: 0, max: 3 }),
    sharedSelector: fc.integer({ min: 0, max: 3 }),
    winnerSelector: fc.integer({ min: 0, max: 3 }),
  })
  .map(({ first, shared, firstSelector, sharedSelector, winnerSelector }) => [
    [
      { target: first, selector: firstSelector },
      { target: shared, selector: sharedSelector },
    ],
    [{ target: shared, selector: winnerSelector }],
  ] as const)

const extraBatchArbitrary = fc
  .shuffledSubarray(CELLS_C, { minLength: 1, maxLength: CELLS_C.length })
  .chain((targets) =>
    fc.array(fc.integer({ min: 0, max: 3 }), { minLength: targets.length, maxLength: targets.length }).map((selectors) =>
      targets.map((target, index) => ({ target, selector: selectors[index]! })),
    ),
  )

const interleavingArbitrary = fc
  .tuple(specialBatchesArbitrary, fc.array(extraBatchArbitrary, { minLength: 1, maxLength: 5 }))
  .chain(([specialBatches, extraBatches]) => {
    const count = specialBatches.length + extraBatches.length
    const ids = Array.from({ length: count }, (_, id) => id)
    const extraIds = ids.slice(specialBatches.length)
    return fc
      .record({
        prepareOrder: fc.shuffledSubarray(ids, { minLength: count, maxLength: count }),
        extraPublishOrder: fc.shuffledSubarray(extraIds, { minLength: extraIds.length, maxLength: extraIds.length }),
        extraCutoffs: fc.array(fc.integer({ min: 1, max: count }), {
          minLength: extraIds.length,
          maxLength: extraIds.length,
        }),
      })
      .map(({ prepareOrder, extraPublishOrder, extraCutoffs }) => ({
        batches: [...specialBatches, ...extraBatches],
        prepareOrder,
        extraPublishOrder,
        extraCutoffs,
      }))
  })

const commandsFor = (schedule: InterleavingSchedule): ReadonlyArray<Command> => {
  const prepareSteps = new Map(schedule.prepareOrder.map((id, index) => [id, index + 1]))
  const cutoffs = new Map(
    schedule.extraPublishOrder.map((id, index) => [id, Math.max(prepareSteps.get(id)!, schedule.extraCutoffs[index]!)]),
  )
  const commands: Command[] = []

  for (let step = 1; step <= schedule.batches.length; step += 1) {
    commands.push({ _tag: 'Prepare', batchId: schedule.prepareOrder[step - 1]! })
    for (const id of schedule.extraPublishOrder) {
      if (cutoffs.get(id) === step) commands.push({ _tag: 'Publish', batchId: id })
    }
    if (step === schedule.batches.length) {
      commands.push({ _tag: 'Publish', batchId: 1 }, { _tag: 'Publish', batchId: 0 })
    }
  }

  return commands
}

describe('ChunkStore batch public API properties', () => {
  it('returns success or a typed prepare failure without changing resident snapshots', async () => {
    const store = await run(freshStore())
    await loadModelChunks(store)
    const before = await readResidentState(store)

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          first: arbitraryCell,
          second: arbitraryCell,
          blocks: fc.tuple(arbitraryValidBlock, arbitraryValidBlock, arbitraryValidBlock, arbitraryValidBlock),
          invalidBlock: arbitraryInvalidBlock,
          outOfWorldY: fc.constantFrom(-1, CHUNK_HEIGHT),
          nonFinite: fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
          fuzzedEdits: fc.array(arbitraryEdit, { maxLength: 8 }),
        }),
        async ({ first, second, blocks, invalidBlock: badBlock, outOfWorldY, nonFinite, fuzzedEdits }) => {
          const nonFinitePosition = unsafePosition(nonFinite, first.y, first.z)
          const cases: ReadonlyArray<{
            readonly name: string
            readonly expected: 'Success' | 'Failure' | 'Either'
            readonly edits: ReadonlyArray<ChunkBlockEdit>
          }> = [
            { name: 'valid edit', expected: 'Success', edits: [validEdit(first, blocks[0])] },
            { name: 'empty batch', expected: 'Failure', edits: [] },
            { name: 'non-array batch', expected: 'Failure', edits: invalidBatchInput(null) },
            { name: 'non-object edit', expected: 'Failure', edits: [null as unknown as ChunkBlockEdit] },
            {
              name: 'duplicate position',
              expected: 'Failure',
              edits: [validEdit(first, blocks[1]), validEdit(first, blocks[2])],
            },
            {
              name: 'out-of-world coordinate after a valid edit',
              expected: 'Failure',
              edits: [validEdit(first, blocks[1]), publicEdit(unsafePosition(second.x, outOfWorldY, second.z), blocks[2])],
            },
            {
              name: 'non-finite coordinate after a valid edit',
              expected: 'Failure',
              edits: [validEdit(first, blocks[1]), publicEdit(nonFinitePosition, blocks[2])],
            },
            {
              name: 'invalid block id after a valid edit',
              expected: 'Failure',
              edits: [validEdit(first, blocks[1]), validEdit(second, invalidBlock(badBlock))],
            },
            { name: 'generated mixed edits', expected: 'Either', edits: fuzzedEdits },
          ]

          for (const testCase of cases) {
            // oxlint-disable-next-line no-await-in-loop -- Keep each prepare and its state check ordered on the shared store.
            const outcome = await run(
              Effect.match(store.prepare(testCase.edits), {
                onFailure: (error) => ({ _tag: 'Failure' as const, error }),
                onSuccess: () => ({ _tag: 'Success' as const }),
              }),
            )

            if (testCase.expected !== 'Either') expect(outcome._tag, testCase.name).toBe(testCase.expected)
            if (outcome._tag === 'Failure') {
              expect(['ChunkWriteInvalidBatch', 'ChunkWriteChunkUnavailable'], testCase.name).toContain(
                outcome.error._tag,
              )
            }

            // oxlint-disable-next-line no-await-in-loop -- Verify the current prepare before starting the next one.
            await expectResidentStateUnchanged(store, before)
          }
        },
      ),
      { numRuns: 50 },
    )
  })

  it('matches a per-chunk epoch model across generated prepare/publish interleavings', async () => {
    await fc.assert(
      fc.asyncProperty(interleavingArbitrary, async (schedule) => {
        const store = await run(freshStore())
        await loadModelChunks(store)

        let model = initialModel()
        const tokens = new Map<number, { readonly prepared: PreparedBatch; readonly model: ModelToken }>()
        const commands = commandsFor(schedule)

        for (const command of commands) {
          if (command._tag === 'Prepare') {
            const edits = realiseEdits(model, schedule.batches[command.batchId]!)
            // oxlint-disable-next-line no-await-in-loop -- Each prepared token captures the model state at this command's position.
            const prepared = await run(
              Effect.match(store.prepare(edits.map(({ target, block }) => validEdit(target, block))), {
                onFailure: (error) => ({ _tag: 'Failure' as const, error }),
                onSuccess: (value) => ({ _tag: 'Success' as const, value }),
              }),
            )
            if (prepared._tag !== 'Success') throw new Error(`generated valid batch failed: ${String(prepared.error)}`)
            tokens.set(command.batchId, { prepared: prepared.value, model: prepareModelToken(model, edits) })
            continue
          }

          const token = tokens.get(command.batchId)!
          const shouldSucceed = modelCanPublish(model, token.model)
          if (command.batchId === 1) expect(shouldSucceed, 'the competing single-chunk token is fresh').toBe(true)
          if (command.batchId === 0) {
            expect(shouldSucceed, 'the cross-chunk token is stale after the B-only publish').toBe(false)
            expect(token.model.baseEpochs.get('0,0')).toBe(model.epochs.get('0,0'))
            expect(token.model.baseEpochs.get('1,0')).not.toBe(model.epochs.get('1,0'))
          }

          // oxlint-disable-next-line no-await-in-loop -- Publish order determines which prepared token is stale.
          const outcome = await run(
            Effect.match(store.publish(token.prepared), {
              onFailure: (error) => ({ _tag: 'Failure' as const, error }),
              onSuccess: () => ({ _tag: 'Success' as const }),
            }),
          )

          expect(outcome._tag).toBe(shouldSucceed ? 'Success' : 'Failure')
          if (!shouldSucceed && outcome._tag === 'Failure') {
            expect(outcome.error).toEqual(expect.objectContaining({ _tag: 'ChunkWriteStale' }))
          }
          if (shouldSucceed) model = publishModel(model, token.model)

          // oxlint-disable-next-line no-await-in-loop -- Confirm the model after each publish before applying the next command.
          await expectSnapshotsMatchModel(store, model)
        }
      }),
      { numRuns: 50 },
    )
  })
})
