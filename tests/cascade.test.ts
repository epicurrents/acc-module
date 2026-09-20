/**
 * Tests for `AccRecording.addCascadeMontagesFromEntries` — the declarative API that turns a list of
 * candidate-source names plus display settings into `AccCascadeMontage` instances.
 *
 * The method is exercised through `AccRecording.prototype`, bound to a stub carrying only the members
 * it reads. Constructing a real resource would pull in the worker, the memory manager and the whole
 * activation lifecycle, none of which this method touches.
 *
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import AccRecording from '../src/AccRecording'
import type { AccCascadeEntry } from '../src/types'

vi.mock('scoped-event-log', () => ({
    Log: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

/** A montage stand-in recording the display settings the method applies to it. */
const makeMontage = (name: string) => ({
    name,
    sensitivity: -1,
    setHighpassFilter: vi.fn().mockResolvedValue(undefined),
    setLowpassFilter: vi.fn().mockResolvedValue(undefined),
})

/**
 * Build a `this` carrying the members `addCascadeMontagesFromEntries` reads: the setup it resolves
 * candidates against, the montage list it checks for duplicates, and the `addCascadeMontage` it
 * delegates creation to.
 */
const makeContext = (options: {
    channels?: Array<{ name: string, label: string }>
    derivations?: Array<{ name: string, label: string }>
    existingMontages?: string[]
    createReturns?: (name: string) => ReturnType<typeof makeMontage> | null
} = {}) => {
    const created: Array<ReturnType<typeof makeMontage>> = []
    const addCascadeMontage = vi.fn((name: string) => {
        const montage = options.createReturns ? options.createReturns(name) : makeMontage(name)
        if (montage) {
            created.push(montage)
        }
        return Promise.resolve(montage)
    })
    const context = {
        _setup: {
            name: 'acc',
            channels: (options.channels ?? []).map(c => ({ ...c, modality: 'acc' })),
            derivations: options.derivations,
        },
        montages: (options.existingMontages ?? []).map(name => ({ name })),
        addCascadeMontage,
    }
    return { context, addCascadeMontage, created }
}

const entry = (over: Partial<AccCascadeEntry> = {}): AccCascadeEntry => ({
    id: 'wrist',
    label: 'Wrist',
    candidates: ['wrist_mag', 'wrist_x'],
    rowCount: 4,
    pageLength: 30,
    ...over,
})

/** Invoke the real method against a stub context. */
const run = (context: object, entries: AccCascadeEntry[]) =>
    (AccRecording.prototype.addCascadeMontagesFromEntries as (
        this: unknown, e: AccCascadeEntry[],
    ) => Promise<string[]>).call(context, entries)

describe('addCascadeMontagesFromEntries candidate resolution', () => {
    beforeEach(() => { vi.clearAllMocks() })

    it('prefers a derivation over a source channel of the same group', async () => {
        const { context, addCascadeMontage } = makeContext({
            channels: [{ name: 'wrist_x', label: 'wrist_x' }],
            derivations: [{ name: 'wrist_mag', label: 'Wrist |a|' }],
        })
        const added = await run(context, [entry()])
        expect(added).toEqual(['cascade:wrist'])
        expect(addCascadeMontage.mock.calls[0][3]).toBe('wrist_mag')
    })

    it('falls back to a source channel when no derivation matches', async () => {
        const { context, addCascadeMontage } = makeContext({
            channels: [
                { name: 'wrist_x', label: 'wrist_x' },
                { name: 'wrist_y', label: 'wrist_y' },
            ],
        })
        await run(context, [entry()])
        expect(addCascadeMontage.mock.calls[0][3]).toBe('wrist_x')
    })

    it('matches a candidate by label as well as by name', async () => {
        const { context, addCascadeMontage } = makeContext({
            derivations: [{ name: 'wrist_mag', label: 'Wrist |a|' }],
        })
        await run(context, [entry({ candidates: ['Wrist |a|'] })])
        expect(addCascadeMontage.mock.calls[0][3]).toBe('Wrist |a|')
    })

    it('takes the earliest candidate when several would resolve', async () => {
        const { context, addCascadeMontage } = makeContext({
            derivations: [
                { name: 'wrist_mag', label: 'Wrist |a|' },
                { name: 'ankle_mag', label: 'Ankle |a|' },
            ],
        })
        await run(context, [entry({ candidates: ['ankle_mag', 'wrist_mag'] })])
        expect(addCascadeMontage.mock.calls[0][3]).toBe('ankle_mag')
    })

    it('skips an entry whose candidates do not resolve, without creating a montage', async () => {
        const { context, addCascadeMontage } = makeContext({
            channels: [{ name: 'wrist_x', label: 'wrist_x' }],
        })
        const added = await run(context, [entry({ id: 'ankle', candidates: ['ankle_mag'] })])
        expect(added).toEqual([])
        expect(addCascadeMontage).not.toHaveBeenCalled()
    })

    it('skips an entry whose cascade name is already registered', async () => {
        const { context, addCascadeMontage } = makeContext({
            derivations: [{ name: 'wrist_mag', label: 'Wrist |a|' }],
            existingMontages: ['cascade:wrist'],
        })
        const added = await run(context, [entry()])
        expect(added).toEqual([])
        expect(addCascadeMontage).not.toHaveBeenCalled()
    })

    it('resolves against source channels when the setup declares no derivations', async () => {
        const { context, addCascadeMontage } = makeContext({
            channels: [{ name: 'wrist_x', label: 'wrist_x' }],
        })
        await run(context, [entry({ candidates: ['wrist_x'] })])
        expect(addCascadeMontage.mock.calls[0][3]).toBe('wrist_x')
    })

    it('returns an empty list for no entries and for a resource without a setup', async () => {
        const { context } = makeContext({ derivations: [{ name: 'wrist_mag', label: 'Wrist |a|' }] })
        expect(await run(context, [])).toEqual([])
        expect(await run({ ...context, _setup: null }, [entry()])).toEqual([])
    })

    it('omits an entry from the result when montage creation returns null', async () => {
        const { context } = makeContext({
            derivations: [{ name: 'wrist_mag', label: 'Wrist |a|' }],
            createReturns: () => null,
        })
        expect(await run(context, [entry()])).toEqual([])
    })

    it('carries the entry label, row count and page length into the creation call', async () => {
        const { context, addCascadeMontage } = makeContext({
            derivations: [{ name: 'wrist_mag', label: 'Wrist |a|' }],
        })
        await run(context, [entry({ rowCount: 6, pageLength: 15 })])
        const call = addCascadeMontage.mock.calls[0]
        expect(call[0]).toBe('cascade:wrist')
        expect(call[1]).toBe('Wrist')
        expect(call[4]).toBe(6)
        expect(call[5]).toBe(15)
    })

    it('adds every resolving entry of a multi-entry list', async () => {
        const { context } = makeContext({
            derivations: [
                { name: 'wrist_mag', label: 'Wrist |a|' },
                { name: 'ankle_mag', label: 'Ankle |a|' },
            ],
        })
        const added = await run(context, [
            entry({ id: 'wrist', candidates: ['wrist_mag'] }),
            entry({ id: 'nope', candidates: ['missing'] }),
            entry({ id: 'ankle', candidates: ['ankle_mag'] }),
        ])
        expect(added).toEqual(['cascade:wrist', 'cascade:ankle'])
    })
})

describe('addCascadeMontagesFromEntries display settings', () => {
    beforeEach(() => { vi.clearAllMocks() })

    const withDerivation = () => makeContext({
        derivations: [{ name: 'wrist_mag', label: 'Wrist |a|' }],
    })

    it('applies every supplied display setting to the created montage', async () => {
        const { context, created } = withDerivation()
        await run(context, [entry({ sensitivity: 250, highpass: 0.5, lowpass: 20 })])
        const montage = created[0]
        expect(montage.sensitivity).toBe(250)
        expect(montage.setHighpassFilter).toHaveBeenCalledWith(0.5)
        expect(montage.setLowpassFilter).toHaveBeenCalledWith(20)
    })

    it('leaves a setting the entry omits untouched', async () => {
        const { context, created } = withDerivation()
        await run(context, [entry()])
        const montage = created[0]
        expect(montage.sensitivity).toBe(-1)
        expect(montage.setHighpassFilter).not.toHaveBeenCalled()
        expect(montage.setLowpassFilter).not.toHaveBeenCalled()
    })

    it('applies a zero filter, which disables that filter rather than meaning "unset"', async () => {
        const { context, created } = withDerivation()
        await run(context, [entry({ sensitivity: 0, highpass: 0, lowpass: 0 })])
        const montage = created[0]
        expect(montage.sensitivity).toBe(0)
        expect(montage.setHighpassFilter).toHaveBeenCalledWith(0)
        expect(montage.setLowpassFilter).toHaveBeenCalledWith(0)
    })
})
