/**
 * Public type surface of the ACC module.
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import type {
    BaseModuleSettings,
    BiosignalDataService,
    BiosignalLaterality,
    BiosignalResource,
    CommonBiosignalSettings,
    StudyContext,
} from '@epicurrents/core/dist/types'

export interface AccDataService extends BiosignalDataService {}

/**
 * Sampling-rate convention for accelerometry magnitude — same as the inputs
 * (Phase 1's pipeline materialises one sample per input sample). No upsampling.
 */
export type AccModuleSettings = BaseModuleSettings & CommonBiosignalSettings & {
    /**
     * Channel-name parsing: how the source-channel labels encode the (group, axis)
     * pair. The default `'<group>_<axis>'` matches the canonical
     * `wrist_x`/`wrist_y`/`wrist_z` layout. Override to a custom regex when the
     * source file uses a different convention; the regex must have two named
     * groups `group` and `axis`.
     */
    channelNamePattern: string
    /**
     * Side-colour map: assign laterality from the sensor group name. Keys are
     * lower-cased group-name prefixes; values are `BiosignalLaterality`. The
     * first matching prefix wins, falling back to `''` (no side) for unmatched.
     */
    sideMap: Array<[string, BiosignalLaterality]>
}

/**
 * One parsed sensor group — the (group, axis) → channel-index map derived from
 * the source's channel labels.
 */
export type AccSensorGroup = {
    /** Group identifier (e.g. `'wrist'`). */
    id: string
    /** Display label (defaults to capitalised id). */
    label: string
    /** Laterality assigned via {@link AccModuleSettings.sideMap}; `''` for unmatched. */
    laterality: BiosignalLaterality
    /** Per-axis source-channel indices. Missing axes are `null`. */
    axes: { x: number | null, y: number | null, z: number | null }
    /** Common sampling rate of the group's axes. Zero when inconsistent or missing. */
    samplingRate: number
}

export interface AccResource extends BiosignalResource {
    /**
     * Sensor groups derived from the channel-label parse, populated during
     * `_applyDefaultSetups()`. Empty when no group resolves all three axes.
     */
    sensorGroups: AccSensorGroup[]
}

/**
 * ACC study context with the meta properties every accelerometry recording carries.
 */
export type AccStudyContext = StudyContext & {
    meta: StudyContext['meta'] & {
        duration: number
        nChannels: number
        samplingRate: number
    }
}

export type SetupAccWorkerResponse = {
    length: number
    samplingRate: number
}

/**
 * Declarative entry for `AccRecording.addCascadeMontagesFromEntries`. Each
 * entry produces at most one cascade montage — the first candidate that
 * resolves against the recording's setup (derivations first, then source
 * channels) wins. Per-entry display defaults are applied on creation.
 */
export type AccCascadeEntry = {
    /** Stable identifier — becomes the montage name as `cascade:<id>`. */
    id: string
    /** Display label shown in the montage picker. */
    label: string
    /**
     * Source candidates in priority order. Names are matched against
     * `setup.derivations` (so magnitude-derivation names like `wrist_mag`
     * resolve) before falling back to source channels.
     */
    candidates: string[]
    /** Number of stacked rows. */
    rowCount: number
    /** Page length per row in seconds. */
    pageLength: number
    /** Initial sensitivity (display-unit per cm). Optional. */
    sensitivity?: number
    /** Initial highpass filter (Hz). Optional. */
    highpass?: number
    /** Initial lowpass filter (Hz). Optional. */
    lowpass?: number
    /** Initial notch filter (Hz). Optional. */
    notch?: number
}
