/**
 * Epicurrents ACC module utilities.
 *
 * Pure helpers for parsing source-channel labels into {@link AccSensorGroup}s
 * and projecting those groups into the {@link SetupDerivation} entries core's
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
import { Log } from 'scoped-event-log'

const SCOPE = 'acc-util'

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
 *
 * Group identity is case-insensitive, matching the axis match. Keying on the raw spelling splits
 * `Wrist_x, wrist_y, wrist_z` into two groups that each resolve no magnitude, which is
 * indistinguishable in the log from a file whose labels did not parse at all. The label keeps the
 * first spelling seen, capitalised.
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
        id: string
        label: string
        laterality: BiosignalLaterality
        axes: { x: number | null, y: number | null, z: number | null }
        rates: number[]
        units: string[]
    }>()
    for (const ch of channels) {
        const match = ch.label?.match(re) ?? ch.name?.match(re)
        if (!match || !match.groups) {
            continue
        }
        const rawGroupId = match.groups.group
        const groupId = rawGroupId.toLowerCase()
        const axis = match.groups.axis.toLowerCase() as 'x' | 'y' | 'z'
        const idx = (ch as SourceChannel).index ?? -1
        if (idx < 0) {
            continue
        }
        if (!byGroup.has(groupId)) {
            byGroup.set(groupId, {
                id: groupId,
                label: capitalise(rawGroupId),
                laterality: sideForGroup(groupId, sideMap),
                axes: { x: null, y: null, z: null },
                rates: [],
                units: [],
            })
        }
        const slot = byGroup.get(groupId)!
        slot.axes[axis] = idx
        if (ch.samplingRate) {
            slot.rates.push(ch.samplingRate)
        }
        if (ch.unit) {
            slot.units.push(ch.unit)
        }
    }
    const groups: AccSensorGroup[] = []
    for (const [id, slot] of byGroup) {
        // A group's rate and unit are the common value when every axis agrees, and empty otherwise.
        // Disagreement is the group's own property rather than any one axis's, so it is recorded
        // here and acted on where a derivation would be built.
        const sr = slot.rates.length && slot.rates.every(r => r === slot.rates[0])
            ? slot.rates[0]
            : 0
        const unit = slot.units.length && slot.units.every(u => u === slot.units[0])
            ? slot.units[0]
            : ''
        groups.push({
            id,
            label: slot.label,
            laterality: slot.laterality,
            axes: slot.axes,
            samplingRate: sr,
            unit,
        })
    }
    return groups
}

/**
 * Project resolved (3-axis) sensor groups into `SetupDerivation` entries that
 * declare the magnitude per group. Core's pipeline materialises these into
 * cache slots alongside source signals and computes `sqrt(x² + y² + z²)` for
 * each sample.
 *
 * A group is skipped unless all three axes are present and agree on a sampling rate. Magnitude is
 * undefined for incomplete sensor data, and substituting zero for a missing axis would produce a
 * smaller-but-plausible signal rather than an obvious failure.
 *
 * Axes at different rates are the same argument in a less obvious costume. Core reads every active
 * input at the same sample index, so mismatched rates combine samples from different instants and
 * degenerate to `sqrt(x² + y²)` past the shortest axis. Emitting the derivation with a zero rate
 * does not prevent this: core reads the field as `samplingRate || <first input's rate>`, so a zero
 * is a fallback rather than a refusal.
 */
export function magnitudeDerivationsForGroups (
    groups: AccSensorGroup[],
): SetupDerivation[] {
    const derivations: SetupDerivation[] = []
    for (const g of groups) {
        const { x, y, z } = g.axes
        if (x === null || y === null || z === null) {
            Log.debug(`Skipping magnitude for sensor group '${g.id}': not all three axes resolved.`, SCOPE)
            continue
        }
        if (g.samplingRate <= 0) {
            Log.debug(
                `Skipping magnitude for sensor group '${g.id}': its axes do not share a sampling rate.`,
                SCOPE,
            )
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
            // The magnitude shares its inputs' display unit. Naming a different one here does not
            // convert anything — the materialisation is a plain root-sum-of-squares — it only makes
            // the derived row render against a different scale from the axes it came from.
            unit: g.unit,
        })
    }
    return derivations
}
