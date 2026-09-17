/**
 * Epicurrents ACC montage.
 *
 * Flat (non-cascade) modality wrapper around `GenericBiosignalMontage`. The
 * `AccCascadeMontage` sibling is for stacked, per-row cascade displays; this
 * one is the standard one-row-per-channel form that the default `'rec'`
 * montage uses to surface ACC axes and magnitude derivations through the
 * montage worker's filter / sensitivity pipeline (raw source channels
 * bypass that pipeline).
 *
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericBiosignalMontage } from '@epicurrents/core'
import { mapMontageChannels } from '@epicurrents/core/util'
import type {
    BiosignalMontage,
    BiosignalMontageTemplate,
    BiosignalSetup,
    ConfigBiosignalMontage,
    ConfigMapChannels,
    MemoryManager,
} from '@epicurrents/core/types'
import AccMontageChannel from './AccMontageChannel'
import type { AccResource } from '#types'
import Log from 'scoped-event-log'

const SCOPE = 'AccMontage'

export default class AccMontage extends GenericBiosignalMontage implements BiosignalMontage {

    constructor (
        name: string,
        recording: AccResource,
        setup: BiosignalSetup,
        template?: BiosignalMontageTemplate,
        manager?: MemoryManager,
        config?: ConfigBiosignalMontage,
    ) {
        super(name, recording, setup, template, manager, config)
    }

    mapChannels (config?: ConfigMapChannels) {
        if (!window.__EPICURRENTS__?.RUNTIME) {
            Log.error(`Reference to main application was not found!`, SCOPE)
            return []
        }
        const channelConfig = Object.assign(
            {},
            window.__EPICURRENTS__.RUNTIME.SETTINGS.modules.acc,
            config ? config : this._config,
        ) as ConfigMapChannels
        const chanProps = mapMontageChannels(this._setup, channelConfig)
        this.channels = chanProps.map((chan) => new AccMontageChannel(
            this,
            chan.name,
            chan.label,
            chan.modality,
            chan.active,
            chan.reference,
            chan.averaged,
            chan.samplingRate,
            chan.unit,
            chan.visible,
            chan,
        ))
        return this.channels
    }
}
