/**
 * ACC cascade montage.
 *
 * Thin wrapper around `GenericBiosignalCascadeMontage` that wraps each row in
 * `AccMontageChannel`. All cascade math — slice geometry, page-step / timebase
 * overrides, source resolution by label — lives in the base class. ACC doesn't
 * pin a per-modality montage worker because the cascade deliberately bypasses
 * the worker via `getAllRawSignals`; each row is the same source signal with
 * no per-channel derivation worker-side.
 *
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericBiosignalCascadeMontage } from '@epicurrents/core'
import type {
    BiosignalSetup,
    ConfigBiosignalMontage,
    MemoryManager,
    MontageChannel,
    SetupChannel,
} from '@epicurrents/core/dist/types'
import AccMontageChannel from './AccMontageChannel'
import type { AccResource } from '#types'

export default class AccCascadeMontage extends GenericBiosignalCascadeMontage {

    constructor (
        name: string,
        recording: AccResource,
        setup: BiosignalSetup,
        sourceLabel: string,
        rowCount: number,
        pageLength: number,
        manager?: MemoryManager,
        config?: ConfigBiosignalMontage,
    ) {
        super(name, recording, setup, sourceLabel, rowCount, pageLength, manager, config)
    }

    protected _createChannel (src: SetupChannel, rowIndex: number): MontageChannel {
        return new AccMontageChannel(
            this,
            `${src.name}_row${rowIndex + 1}`,
            `${src.label} ${rowIndex + 1}`,
            src.modality,
            src.index,
            [],
            false,
            src.samplingRate ?? 0,
            src.unit,
            true,
        )
    }
}
