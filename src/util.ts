/**
 * Epicurrents ACC module utilities.
 *
 * Pure helpers for parsing source-channel labels into {@link AccSensorGroup}s
 * and projecting those groups into the {@link SetupDerivation} entries Phase 1's
 * materialisation pipeline consumes.
 *
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import type {
    BiosignalChannel,
    BiosignalLaterality,
    SetupDerivation,
    SourceChannel,
} from '@epicurrents/core/types'
import type { AccSensorGroup } from '#types'

/**
 * Default channel-label parsing rule — `<group>_<axis>`. The `axis` group is
 * matched case-insensitively against `x` / `y` / `z`.
 */
const DEFAULT_PATTERN = '^(?<group>[A-Za-z0-9]+)_(?<axis>[xyzXYZ])$'

const capitalise = (s: string): string =>
    s.length ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s

const sideForGroup = (
    groupId: string,
    sideMap: Array<[string, BiosignalLaterality]>,
): BiosignalLaterality => {
    const lower = groupId.toLowerCase()
    for (const [prefix, side] of sideMap) {
        if (lower.startsWith(prefix.toLowerCase())) {
            return side
        }
    }
    return ''
}

/**
 * Parse a list of source channels into sensor groups. Channels whose label
 * doesn't match the pattern are silently ignored — they remain plain source
 * channels without a group affiliation (and thus no magnitude derivation).
 *
 * A group only counts as resolved when all three axes (x, y, z) are present;
 * single- or two-axis groups are returned with the missing axes as `null` so
 * callers can decide whether to surface them.
 */
export function parseSensorGroups (
    channels: SourceChannel[] | BiosignalChannel[],
    options: {
        pattern?: string
        sideMap?: Array<[string, BiosignalLaterality]>
    } = {},
): AccSensorGroup[] {
    const re = new RegExp(options.pattern ?? DEFAULT_PATTERN)
    const sideMap = options.sideMap ?? []
    const byGroup = new Map<string, {
        label: string
        laterality: BiosignalLaterality
        axes: { x: number | null, y: number | null, z: number | null }
        rates: number[]
    }>()
    for (const ch of channels) {
        const match = ch.label?.match(re) ?? ch.name?.match(re)
        if (!match || !match.groups) {
            continue
        }
        const groupId = match.groups.group
        const axis = match.groups.axis.toLowerCase() as 'x' | 'y' | 'z'
        const idx = (ch as SourceChannel).index ?? -1
        if (idx < 0) {
            continue
        }
        if (!byGroup.has(groupId)) {
            byGroup.set(groupId, {
                label: capitalise(groupId),
                laterality: sideForGroup(groupId, sideMap),
                axes: { x: null, y: null, z: null },
                rates: [],
            })
        }
        const slot = byGroup.get(groupId)!
        slot.axes[axis] = idx
        if (ch.samplingRate) {
            slot.rates.push(ch.samplingRate)
        }
    }
    const groups: AccSensorGroup[] = []
    for (const [id, slot] of byGroup) {
        // Group sampling rate = the common rate when all observed rates agree, 0 otherwise.
        const sr = slot.rates.length && slot.rates.every(r => r === slot.rates[0])
            ? slot.rates[0]
            : 0
        groups.push({
            id,
            label: slot.label,
            laterality: slot.laterality,
            axes: slot.axes,
            samplingRate: sr,
        })
    }
    return groups
}

/**
 * Project resolved (3-axis) sensor groups into `SetupDerivation` entries that
 * declare the magnitude per group. Phase 1's pipeline materialises these into
 * cache slots alongside source signals and computes `sqrt(x² + y² + z²)` for
 * each sample.
 *
 * Groups missing one or more axes are skipped — magnitude is undefined for
 * incomplete sensor data, and silently substituting zero would be misleading.
 */
export function magnitudeDerivationsForGroups (
    groups: AccSensorGroup[],
): SetupDerivation[] {
    const derivations: SetupDerivation[] = []
    for (const g of groups) {
        const { x, y, z } = g.axes
        if (x === null || y === null || z === null) {
            continue
        }
        derivations.push({
            active: [x, y, z],
            averaged: false,
            displayPolarity: 0,
            label: `${g.label} |a|`,
            laterality: g.laterality,
            modality: 'acc',
            name: `${g.id}_mag`,
            operation: 'magnitude',
            reference: [],
            samplingRate: g.samplingRate,
            scale: 0,
            unit: 'm/s²',
        })
    }
    return derivations
}
