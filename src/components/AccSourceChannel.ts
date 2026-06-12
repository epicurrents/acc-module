/**
 * Epicurrents ACC source channel.
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericSourceChannel } from '@epicurrents/core'
import type { BiosignalChannel } from '@epicurrents/core/dist/types'

export default class AccSourceChannel extends GenericSourceChannel {

    constructor (
        name: string,
        label: string,
        index: number,
        samplingRate: number,
        visible: boolean,
        // Physical unit defaults to `'g'` because accelerometer files most
        // commonly come in g; `getSignalScale('g') = 9.80665` normalises to
        // m/s² on decode (extended in Phase 2 core util).
        unit = 'g',
        extraProperties: Partial<BiosignalChannel> = {},
    ) {
        super(name, label, 'acc', index, false, samplingRate, unit, visible, extraProperties)
    }
}
