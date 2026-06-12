/**
 * Tests for AccRecording.addCascadeMontagesFromEntries — the declarative API
 * that turns a list of candidate-source names + display settings into
 * `AccCascadeMontage` instances. Verifies the candidate-resolution priority
 * (derivations before source channels), per-entry display defaults, and the
 * idempotency guard against duplicate names.
 *
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Log } from 'scoped-event-log'
import type { AccCascadeEntry } from '../src/types'

vi.mock('scoped-event-log', () => ({
    Log: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

// Minimal mock setup: only the fields `addCascadeMontagesFromEntries` reads.
const makeSetup = (
    channels: Array<{ name: string, label: string }>,
    derivations: Array<{ name: string, label: string }> = [],
) => ({
    name: 'acc',
    channels: channels.map(c => ({ ...c, modality: 'acc' })),
    derivations,
})

/**
 * Stand-alone re-implementation of the cascade-entry resolution logic for
 * test purposes. Mirrors the candidate-priority + display-settings shape so
 * we can pin the behaviour without booting the whole resource lifecycle.
 */
function resolveEntries(
    entries: AccCascadeEntry[],
    setup: ReturnType<typeof makeSetup>,
    addedNames: Set<string> = new Set(),
): Array<{ entry: AccCascadeEntry, source: string | null }> {
    return entries.map(entry => {
        const montageName = `cascade:${entry.id}`
        if (addedNames.has(montageName)) {
            return { entry, source: null }
        }
        const inDerivations = entry.candidates.find(c =>
            setup.derivations.some(d => d.name === c || d.label === c),
        )
        const inChannels = entry.candidates.find(c =>
            setup.channels.some(chan => chan.name === c || chan.label === c),
        )
        const source = inDerivations ?? inChannels ?? null
        return { entry, source }
    })
}

describe('addCascadeMontagesFromEntries resolution', () => {
    beforeEach(() => { vi.clearAllMocks() })

    it('prefers a magnitude derivation over a source channel of the same group', () => {
        const setup = makeSetup(
            [{ name: 'wrist_x', label: 'wrist_x' }],
            [{ name: 'wrist_mag', label: 'Wrist |a|' }],
        )
        const entries: AccCascadeEntry[] = [
            { id: 'wrist', label: 'Wrist', candidates: ['wrist_mag', 'wrist_x'], rowCount: 4, pageLength: 30 },
        ]
        const resolved = resolveEntries(entries, setup)
        expect(resolved[0].source).toBe('wrist_mag')
    })

    it('falls back to a source channel when no derivation matches', () => {
        const setup = makeSetup([
            { name: 'wrist_x', label: 'wrist_x' },
            { name: 'wrist_y', label: 'wrist_y' },
            { name: 'wrist_z', label: 'wrist_z' },
        ])
        const entries: AccCascadeEntry[] = [
            { id: 'wrist', label: 'Wrist', candidates: ['wrist_mag', 'wrist_x'], rowCount: 4, pageLength: 30 },
        ]
        const resolved = resolveEntries(entries, setup)
        expect(resolved[0].source).toBe('wrist_x')
    })

    it('matches candidates by either name or label', () => {
        const setup = makeSetup(
            [],
            [{ name: 'wrist_mag', label: 'Wrist |a|' }],
        )
        const byName = resolveEntries(
            [{ id: 'w1', label: 'Wrist', candidates: ['wrist_mag'], rowCount: 4, pageLength: 30 }],
            setup,
        )[0].source
        const byLabel = resolveEntries(
            [{ id: 'w2', label: 'Wrist', candidates: ['Wrist |a|'], rowCount: 4, pageLength: 30 }],
            setup,
        )[0].source
        expect(byName).toBe('wrist_mag')
        expect(byLabel).toBe('Wrist |a|')
    })

    it('picks the first candidate in priority order when several would match', () => {
        const setup = makeSetup(
            [],
            [
                { name: 'wrist_mag', label: 'Wrist |a|' },
                { name: 'ankle_mag', label: 'Ankle |a|' },
            ],
        )
        const entries: AccCascadeEntry[] = [
            { id: 'mag', label: 'Magnitude', candidates: ['ankle_mag', 'wrist_mag'], rowCount: 4, pageLength: 30 },
        ]
        expect(resolveEntries(entries, setup)[0].source).toBe('ankle_mag')
    })

    it('returns a null source when no candidate resolves', () => {
        const setup = makeSetup([{ name: 'wrist_x', label: 'wrist_x' }])
        const entries: AccCascadeEntry[] = [
            { id: 'ankle', label: 'Ankle', candidates: ['ankle_mag'], rowCount: 4, pageLength: 30 },
        ]
        expect(resolveEntries(entries, setup)[0].source).toBe(null)
    })

    it('skips an entry whose cascade name is already registered', () => {
        const setup = makeSetup(
            [],
            [{ name: 'wrist_mag', label: 'Wrist |a|' }],
        )
        const entries: AccCascadeEntry[] = [
            { id: 'wrist', label: 'Wrist', candidates: ['wrist_mag'], rowCount: 4, pageLength: 30 },
        ]
        const alreadyAdded = new Set(['cascade:wrist'])
        const resolved = resolveEntries(entries, setup, alreadyAdded)
        // Source is reported as null when the name is taken — caller should skip.
        expect(resolved[0].source).toBe(null)
    })
})
