/**
 * Epicurrents ACC module default settings.
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { BiosignalAnnotationEvent } from '@epicurrents/core/types'
import type { AccModuleSettings } from '#types'

const accSettings: AccModuleSettings = {
    /**
     * Canonical IMU layout: `<group>_<axis>` (e.g. `wrist_x`, `wrist_y`,
     * `wrist_z`). Override via the host config when the source file uses a
     * different convention. The regex MUST have two named capture groups
     * called `group` and `axis`.
     */
    channelNamePattern: '^(?<group>[A-Za-z0-9]+)_(?<axis>[xyzXYZ])$',
    events: {
        convertPatterns: [] as [string, BiosignalAnnotationEvent][],
        ignorePatterns: [] as string[],
    },
    // Modality → list of filter types whose recording-level default propagates
    // to channels of that modality. Without an entry for `'acc'`, the helper
    // `getChannelFilters` falls back to each channel's own (zero) filter value
    // and the recording-level `filters.highpass`/`lowpass`/`notch` set via the
    // controls silently never reach the worker.
    filterChannelTypes: {
        acc: ['highpass', 'lowpass'],
    },
    // A low high-pass (the 0.5 Hz default that removes the gravity baseline) settles slowly, so it benefits from a
    // couple of seconds of padding on each side for the per-page filter edges; the 0.1 s suited to fast EEG filters
    // is too short. The gravity-offset start transient itself is handled in `filterSignal` (mean removal), not here.
    filterPaddingSeconds: 2,
    // Empty by default — accelerometry has no canonical band taxonomy like the
    // EEG δ/θ/α/β set. The FftTool iterates this array to draw guideline bars
    // and compute per-band powers; an empty array suppresses both, leaving the
    // raw spectrum visible. A deployment that wants posture / tremor bands can
    // override per-host (e.g. { name: 'tremor', upperLimit: 12 }).
    frequencyBands: [] as { name: string, symbol?: string, upperLimit: number }[],
    showHiddenChannels: false,
    showMissingChannels: false,
    /**
     * Group-name → laterality assignment. Lower-case prefix match: the first
     * entry whose key matches the group name's start wins. `BiosignalLaterality`
     * uses the anatomical abbreviations `'s'` (sinister = left), `'d'` (dexter
     * = right), `'z'` (zentral = midline), and `''` (unspecified). Unmatched
     * groups land at `''` and pick up the midline trace colour.
     */
    sideMap: [
        ['leftwrist', 's'],
        ['rightwrist', 'd'],
        ['leftankle', 's'],
        ['rightankle', 'd'],
    ],
    unloadOnClose: false,
    useMemoryManager: true,
}

export default accSettings
