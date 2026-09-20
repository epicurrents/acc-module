/**
 * Unit tests for the ACC module's sensor-group parser and magnitude-derivation
 * projector — the pure helpers `AccRecording._applyDefaultSetups` composes to
 * turn channel labels into the `SetupDerivation` entries core materialises.
 *
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    magnitudeDerivationsForGroups,
    parseSensorGroups,
} from '../src/util'

const ch = (name: string, index: number, samplingRate = 100, label?: string) => ({
    name,
    label: label ?? name,
    index,
    samplingRate,
    modality: 'acc',
    unit: 'g',
    laterality: '',
    visible: true,
}) as any

describe('parseSensorGroups', () => {
    it('groups a canonical 3-axis layout under one sensor', () => {
        const groups = parseSensorGroups([
            ch('wrist_x', 0),
            ch('wrist_y', 1),
            ch('wrist_z', 2),
        ])
        expect(groups).toHaveLength(1)
        expect(groups[0].id).toBe('wrist')
        expect(groups[0].axes).toEqual({ x: 0, y: 1, z: 2 })
        expect(groups[0].samplingRate).toBe(100)
    })

    it('separates multiple sensor groups', () => {
        const groups = parseSensorGroups([
            ch('wrist_x', 0), ch('wrist_y', 1), ch('wrist_z', 2),
            ch('ankle_x', 3), ch('ankle_y', 4), ch('ankle_z', 5),
        ])
        expect(groups.map(g => g.id).sort()).toEqual(['ankle', 'wrist'])
    })

    it('returns groups with missing axes as `null` slots', () => {
        const groups = parseSensorGroups([
            ch('wrist_x', 0),
            ch('wrist_y', 1),
            // No z.
        ])
        expect(groups).toHaveLength(1)
        expect(groups[0].axes).toEqual({ x: 0, y: 1, z: null })
    })

    it('matches axis labels case-insensitively', () => {
        const groups = parseSensorGroups([
            ch('wrist_X', 0),
            ch('wrist_Y', 1),
            ch('wrist_Z', 2),
        ])
        expect(groups[0].axes).toEqual({ x: 0, y: 1, z: 2 })
    })

    it('ignores channels whose label does not match the pattern', () => {
        const groups = parseSensorGroups([
            ch('wrist_x', 0), ch('wrist_y', 1), ch('wrist_z', 2),
            ch('ekg', 3),
            ch('temp', 4),
        ])
        expect(groups).toHaveLength(1)
        expect(groups[0].id).toBe('wrist')
    })

    it('assigns laterality from the sideMap, longest-prefix-style first match', () => {
        const groups = parseSensorGroups(
            [
                ch('leftwrist_x', 0), ch('leftwrist_y', 1), ch('leftwrist_z', 2),
                ch('rightwrist_x', 3), ch('rightwrist_y', 4), ch('rightwrist_z', 5),
                ch('chest_x', 6), ch('chest_y', 7), ch('chest_z', 8),
            ],
            {
                // BiosignalLaterality: 's' = sinister/left, 'd' = dexter/right.
                sideMap: [
                    ['leftwrist', 's'],
                    ['rightwrist', 'd'],
                ],
            },
        )
        const byId = Object.fromEntries(groups.map(g => [g.id, g.laterality]))
        expect(byId.leftwrist).toBe('s')
        expect(byId.rightwrist).toBe('d')
        expect(byId.chest).toBe('')
    })

    it('zeros samplingRate when the group axes disagree', () => {
        const groups = parseSensorGroups([
            ch('wrist_x', 0, 100),
            ch('wrist_y', 1, 200),  // mismatched rate
            ch('wrist_z', 2, 100),
        ])
        expect(groups[0].samplingRate).toBe(0)
    })

    it('groups channels case-insensitively', () => {
        const groups = parseSensorGroups([
            ch('Wrist_x', 0), ch('wrist_y', 1), ch('WRIST_z', 2),
        ])
        expect(groups).toHaveLength(1)
        expect(groups[0].id).toBe('wrist')
        expect(groups[0].axes).toEqual({ x: 0, y: 1, z: 2 })
    })

    it('labels a group from the first spelling it saw', () => {
        expect(parseSensorGroups([ch('WRIST_x', 0), ch('wrist_y', 1)])[0].label).toBe('Wrist')
    })

    it('reports the unit shared by the axes', () => {
        expect(parseSensorGroups([ch('wrist_x', 0), ch('wrist_y', 1)])[0].unit).toBe('g')
    })

    it('empties the unit when the axes disagree on one', () => {
        const mixed = [ch('wrist_x', 0), ch('wrist_y', 1)]
        mixed[1].unit = 'm/s²'
        expect(parseSensorGroups(mixed)[0].unit).toBe('')
    })

    it('honours a custom pattern', () => {
        const groups = parseSensorGroups(
            [
                ch('acc/wrist/x', 0), ch('acc/wrist/y', 1), ch('acc/wrist/z', 2),
            ],
            {
                pattern: '^acc/(?<group>[a-z]+)/(?<axis>[xyz])$',
            },
        )
        expect(groups).toHaveLength(1)
        expect(groups[0].id).toBe('wrist')
    })
})

describe('magnitudeDerivationsForGroups', () => {
    it('emits one derivation per resolved 3-axis group', () => {
        const groups = parseSensorGroups([
            ch('wrist_x', 0), ch('wrist_y', 1), ch('wrist_z', 2),
            ch('ankle_x', 3), ch('ankle_y', 4), ch('ankle_z', 5),
        ])
        const dvs = magnitudeDerivationsForGroups(groups)
        expect(dvs).toHaveLength(2)
        expect(dvs.map(d => d.name).sort()).toEqual(['ankle_mag', 'wrist_mag'])
    })

    it('declares operation=`magnitude` with the three axis indices on `active`', () => {
        const groups = parseSensorGroups([
            ch('wrist_x', 0), ch('wrist_y', 1), ch('wrist_z', 2),
        ])
        const dvs = magnitudeDerivationsForGroups(groups)
        expect(dvs[0].operation).toBe('magnitude')
        expect(dvs[0].active).toEqual([0, 1, 2])
        expect(dvs[0].reference).toEqual([])
    })

    it('skips groups missing one or more axes', () => {
        const groups = parseSensorGroups([
            ch('wrist_x', 0), ch('wrist_y', 1),  // no z
            ch('ankle_x', 2), ch('ankle_y', 3), ch('ankle_z', 4),
        ])
        const dvs = magnitudeDerivationsForGroups(groups)
        expect(dvs).toHaveLength(1)
        expect(dvs[0].name).toBe('ankle_mag')
    })

    it('forwards the laterality and sampling rate from the group', () => {
        const groups = parseSensorGroups(
            [
                ch('leftwrist_x', 0), ch('leftwrist_y', 1), ch('leftwrist_z', 2),
            ],
            { sideMap: [['leftwrist', 's']] },
        )
        const dv = magnitudeDerivationsForGroups(groups)[0]
        expect(dv.laterality).toBe('s')
        expect(dv.samplingRate).toBe(100)
        expect(dv.unit).toBe('g')
        expect(dv.label).toBe('Leftwrist |a|')
    })

    it('skips a group whose axes do not share a sampling rate', () => {
        // Core reads every active input at the same sample index, so mismatched rates combine
        // samples from different instants. Emitting with `samplingRate: 0` would not stop it —
        // core treats a zero as "infer from the first input" rather than as a refusal.
        const groups = parseSensorGroups([
            ch('wrist_x', 0, 100),
            ch('wrist_y', 1, 200),
            ch('wrist_z', 2, 100),
        ])
        expect(groups[0].axes).toEqual({ x: 0, y: 1, z: 2 })
        expect(magnitudeDerivationsForGroups(groups)).toEqual([])
    })

    it('carries the group unit rather than naming a unit of its own', () => {
        const groups = parseSensorGroups([ch('wrist_x', 0), ch('wrist_y', 1), ch('wrist_z', 2)])
        // Materialisation is a plain root-sum-of-squares, so a differing unit would only put the
        // derived row on a different display scale from the axes it was computed from.
        expect(magnitudeDerivationsForGroups(groups)[0].unit).toBe('g')
    })

    it('returns an empty list when no groups resolve', () => {
        expect(magnitudeDerivationsForGroups([])).toEqual([])
    })
})
