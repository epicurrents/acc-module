/**
 * Epicurrents ACC module default settings.
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { BiosignalAnnotationEvent } from '@epicurrents/core/dist/types'
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
    filterPaddingSeconds: 0.1,
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
