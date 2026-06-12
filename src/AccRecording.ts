/**
 * Epicurrents accelerometry recording.
 *
 * Thin wrapper around `GenericBiosignalResource`. The accelerometry-specific
 * logic is concentrated in {@link AccRecording._applyDefaultSetups} — runs
 * during `prepare()` (after the worker has parsed the file header, before the
 * resource is activated), parses source-channel labels into sensor groups, and
 * declares one `SetupDerivation` per resolved three-axis group. Phase 1's
 * materialisation pipeline picks those derivations up automatically: memory
 * budget accounts for them, the worker allocates a cache slot per derivation,
 * and `_materialiseDerivation` computes `sqrt(x² + y² + z²)` sample-by-sample
 * during cache fill.
 *
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import {
    BiosignalMutex,
    GenericBiosignalResource,
    GenericBiosignalSetup,
} from '@epicurrents/core'
import { AssetEvents, BiosignalResourceEvents } from '@epicurrents/core/dist/events'
import type {
    BiosignalSetup,
    SetupChannel,
} from '@epicurrents/core/dist/types'
import { Log } from 'scoped-event-log'
import AccCascadeMontage from '#components/AccCascadeMontage'
import AccService from '#service/AccService'
import AccSourceChannel from '#components/AccSourceChannel'
import {
    magnitudeDerivationsForGroups,
    parseSensorGroups,
} from '#root/src/util'
import type {
    AccCascadeEntry,
    AccModuleSettings,
    AccResource,
    AccSensorGroup,
    AccStudyContext,
} from '#types'

const SCOPE = 'AccRecording'

export default class AccRecording extends GenericBiosignalResource implements AccResource {

    protected _samplingRate: number | null = null
    protected _sensorGroups: AccSensorGroup[] = []
    protected _service: AccService | null = null
    #SETTINGS = (window.__EPICURRENTS__?.RUNTIME?.SETTINGS.modules.acc as AccModuleSettings) || null

    constructor (name: string, source?: AccStudyContext, worker?: Worker) {
        super(name, 'acc', source)
        this.addEventListener(AssetEvents.DEACTIVATE, async () => {
            if (this.#SETTINGS?.unloadOnClose && this._service?.isReady) {
                await this.unload()
            }
        }, this.id)
        if (!source) {
            return
        }
        for (let i = 0; i < source.meta.nChannels; i++) {
            this._channels.push(new AccSourceChannel(
                `ch_${i}`,
                `ACC ${i + 1}`,
                i,
                source.meta.samplingRate || 0,
                true,
            ))
        }
        this._dataDuration = source.meta.duration || 0
        this._totalDuration = this._dataDuration
        this._samplingRate = source.meta.samplingRate || 0
        if (!worker) {
            return
        }
        this._service = new AccService(this, worker)
        this._service.prepareWorker(source).then((response) => {
            if (response) {
                this._state = 'ready'
            } else {
                this._errorReason = 'Preparing worker failed'
                this._state = 'error'
            }
        })
        this._state = 'loading'
        this.addEventListener(AssetEvents.ACTIVATE, async () => {
            if (!this._isActive) {
                return
            }
            if (!this._service?.isReady && this._state === 'ready') {
                this.dispatchEvent(BiosignalResourceEvents.SIGNAL_CACHING_COMPLETE, 'before')
                if (this._memoryManager) {
                    // Memory budget: source channels + derivation slots declared
                    // during `_applyDefaultSetups`. The helper on the base class
                    // walks the setup's derivations and contributes one slot each.
                    let totalMem = 4
                    const dataFieldsLen = BiosignalMutex.SIGNAL_DATA_POS
                    for (const chan of this.channels) {
                        totalMem += chan.samplingRate*this._totalDuration + dataFieldsLen
                    }
                    for (const slot of this._derivationCacheSlots()) {
                        totalMem += slot.sampleCount + dataFieldsLen
                    }
                    const memorySuccess = await this._service?.requestMemory(totalMem)
                    if (!memorySuccess) {
                        Log.error(`Memory allocation failed.`, SCOPE)
                        this.state = 'error'
                        this.errorReason = 'Memory allocation failed'
                        this.isActive = false
                        return
                    }
                    Log.debug(`Memory allocation complete.`, SCOPE)
                    const mutex = await this.setupMutex()
                    if (!mutex) {
                        Log.error(`Mutex setup failed.`, SCOPE)
                        this.state = 'error'
                        this.errorReason = 'Mutex setup failed'
                        this.isActive = false
                        return
                    }
                    Log.debug(`Buffer setup complete.`, SCOPE)
                } else {
                    const dataCache = await this.setupCache()
                    if (!dataCache) {
                        Log.error(`Data cache setup failed.`, SCOPE)
                        this.state = 'error'
                        this.errorReason = 'Data cache setup failed'
                        this.isActive = false
                        return
                    }
                    Log.debug(`Data cache setup complete.`, SCOPE)
                }
                Log.debug(`ACC recording initial setup complete.`, SCOPE)
                const cacheOk = await this.cacheSignals()
                if (cacheOk === false) {
                    Log.error(
                        `Signal caching failed for ${this.name}.`,
                        SCOPE,
                        new Error(`Signal caching failed for ${this.name}.`),
                        {
                            announce:
                                `Could not load "${this.name}" — the recording may be ` +
                                `too large for the configured memory budget.`,
                        },
                    )
                    this._errorReason = this._errorReason || 'Signal caching failed'
                    this.state = 'error'
                }
                this.dispatchEvent(BiosignalResourceEvents.SIGNAL_CACHING_COMPLETE)
            }
        }, this.id)
    }

    get sensorGroups (): AccSensorGroup[] {
        return this._sensorGroups
    }

    /**
     * Build the canonical accelerometry setup from the source channels.
     * Sensor groups are parsed via the channel-name pattern from settings,
     * resolved 3-axis groups produce one `SetupDerivation` each, and the
     * setup is attached to the resource so the activation-time materialisation
     * pipeline sees the derivations during memory sizing.
     */
    protected override async _applyDefaultSetups (): Promise<void> {
        const settings = this.#SETTINGS
        const setup = new GenericBiosignalSetup('acc')
        const setupChannels: SetupChannel[] = this._channels.map((ch, idx) => ({
            active: idx,
            averaged: false,
            displayPolarity: 0,
            index: idx,
            label: ch.label,
            laterality: ch.laterality,
            modality: ch.modality,
            name: ch.name,
            reference: [],
            samplingRate: ch.samplingRate,
            scale: 0,
            unit: ch.unit,
        }))
        setup.channels = setupChannels
        const groups = parseSensorGroups(this._channels, {
            pattern: settings?.channelNamePattern,
            sideMap: settings?.sideMap,
        })
        this._sensorGroups = groups
        setup.derivations = magnitudeDerivationsForGroups(groups)
        this.setup = setup
        Log.debug(
            `ACC setup applied: ${groups.length} sensor group(s), ` +
            `${setup.derivations.length} magnitude derivation(s).`,
            SCOPE,
        )
    }

    /**
     * Override of `GenericBiosignalResource._constructCascadeMontage` so the
     * ACC resource's `addCascadeMontage` produces `AccCascadeMontage` instances
     * — rows wrapped in `AccMontageChannel`. No worker override: cascade reads
     * raw signals directly via `getAllRawSignals` and bypasses the montage
     * worker entirely (see the base class).
     */
    protected override _constructCascadeMontage (
        name: string,
        setup: BiosignalSetup,
        sourceLabel: string,
        rowCount: number,
        pageLength: number,
        config?: { label: string },
    ) {
        return new AccCascadeMontage(
            name, this, setup, sourceLabel, rowCount, pageLength,
            this._memoryManager || undefined, config,
        )
    }

    /**
     * Declarative cascade registration. Each entry names a list of candidate
     * source labels — the first that resolves against the recording's setup
     * (matched on either `name` or `label`) wins. ACC only ever has one setup,
     * so the lookup happens against `this.setup` directly. Per-entry display
     * defaults (sensitivity, filters) are applied to the created cascade so
     * the user gets sane initial values without having to fiddle with each one.
     *
     * Returns the list of cascade montage names that were actually added so
     * callers can confirm which entries resolved.
     */
    async addCascadeMontagesFromEntries (entries: AccCascadeEntry[]): Promise<string[]> {
        if (!entries?.length || !this._setup) {
            return []
        }
        const setup = this._setup
        const added: string[] = []
        for (const entry of entries) {
            const montageName = `cascade:${entry.id}`
            if (this.montages.find(m => m.name === montageName)) {
                continue
            }
            // Match against `setup.derivations` first (so magnitude-derivation
            // labels like `Wrist |a|` resolve) and fall back to source channels.
            const inDerivations = entry.candidates.find(c =>
                setup.derivations?.some(d => d.name === c || d.label === c),
            )
            const inChannels = entry.candidates.find(c =>
                setup.channels.some(chan => chan.name === c || chan.label === c),
            )
            const chosenSource = inDerivations ?? inChannels
            if (!chosenSource) {
                Log.debug(
                    `No cascade source resolved for '${entry.label}' from candidates ` +
                    `[${entry.candidates.join(', ')}].`,
                    SCOPE,
                )
                continue
            }
            const created = await this.addCascadeMontage(
                montageName,
                entry.label,
                setup,
                chosenSource,
                entry.rowCount,
                entry.pageLength,
            )
            if (created) {
                if (typeof entry.sensitivity === 'number') {
                    created.sensitivity = entry.sensitivity
                }
                if (typeof entry.highpass === 'number') {
                    await created.setHighpassFilter(entry.highpass)
                }
                if (typeof entry.lowpass === 'number') {
                    await created.setLowpassFilter(entry.lowpass)
                }
                if (typeof entry.notch === 'number') {
                    await created.setNotchFilter(entry.notch)
                }
                added.push(montageName)
                Log.debug(
                    `Added cascade montage '${entry.label}' for source '${chosenSource}'.`,
                    SCOPE,
                )
            }
        }
        return added
    }

    getMainProperties () {
        const props = super.getMainProperties()
        if (props.size) {
            return props
        } else if (this.state === 'ready') {
            props.set('duration', this._totalDuration)
            props.set('signals', this._channels.length)
        }
        return props
    }
}
