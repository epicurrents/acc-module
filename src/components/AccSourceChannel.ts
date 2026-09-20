/**
 * Epicurrents ACC source channel.
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericSourceChannel } from '@epicurrents/core'
import type { BiosignalChannel } from '@epicurrents/core/types'

export default class AccSourceChannel extends GenericSourceChannel {

    constructor (
        name: string,
        label: string,
        index: number,
        samplingRate: number,
        visible: boolean,
        // Physical unit defaults to `'g'` because accelerometer files most commonly come in g.
        // This is the display unit: samples are normalised to SI on decode, which for g means
        // `getSignalScale('g') = 9.80665`. A reader that skips that scaling leaves the channel
        // holding g while every consumer reads it as m/s².
        unit = 'g',
        extraProperties: Partial<BiosignalChannel> = {},
    ) {
        super(name, label, 'acc', index, false, samplingRate, unit, visible, extraProperties)
    }
}
