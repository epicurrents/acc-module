/**
 * Epicurrents ACC montage channel.
 *
 * Thin wrapper around `GenericMontageChannel` — modality stays at `'acc'`
 * across every montage channel so display code that switches on modality
 * (side-colour theme, cascade overlays) sees the right type even after a
 * cascade row split.
 *
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericMontageChannel } from '@epicurrents/core'
import type {
    BiosignalChannel,
    BiosignalMontage,
    DerivedChannelProperties,
    MontageChannel,
} from '@epicurrents/core/dist/types'

export default class AccMontageChannel extends GenericMontageChannel implements MontageChannel {

    constructor (
        montage: BiosignalMontage,
        name: string,
        label: string,
        modality: string,
        active: number | DerivedChannelProperties,
        reference: DerivedChannelProperties,
        averaged: boolean,
        samplingRate: number,
        unit: string,
        visible: boolean,
        extraProperties: Partial<BiosignalChannel> = {},
    ) {
        super(montage, name, label, modality, active, reference, averaged, samplingRate, unit, visible, extraProperties)
    }
}
