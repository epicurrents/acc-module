/**
 * Epicurrents accelerometry recording.
 *
 * Thin wrapper around `GenericBiosignalResource`. Source-channel construction
 * is driven by the parsed `BiosignalChannel[]` and `BiosignalHeaderRecord` the
 * CSV importer hands over via `study.meta`; `prepare()` then awaits the
 * worker's parse-and-acknowledge round trip before calling
 * {@link AccRecording._applyDefaultSetups}, which declares one
 * `SetupDerivation` per resolved three-axis sensor group. Phase 1's
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
    BiosignalAudio,
    BiosignalMutex,
    GenericBiosignalResource,
    GenericBiosignalSetup,
    getSynthesizer,
} from '@epicurrents/core'
import { AssetEvents, BiosignalResourceEvents } from '@epicurrents/core/dist/events'
import { calculateSignalOffsets } from '@epicurrents/core/dist/util'
import type {
    AudioSynthesisMethod,
    BiosignalChannel,
    BiosignalChannelTemplate,
    BiosignalConfig,
    BiosignalHeaderRecord,
    BiosignalLaterality,
    BiosignalMontage,
    BiosignalMontageTemplate,
    BiosignalSetup,
    ConfigBiosignalMontage,
    ConfigMapChannels,
    MemoryManager,
    SetupChannel,
    StudyContext,
    UrlAccessOptions,
} from '@epicurrents/core/dist/types'
import { Log } from 'scoped-event-log'
import AccCascadeMontage from '#components/AccCascadeMontage'
import AccMontage from '#components/AccMontage'
import AccService from '#service/AccService'
import AccSourceChannel from '#components/AccSourceChannel'
import { AccEvents } from '#events'
import {
    magnitudeDerivationsForGroups,
    parseSensorGroups,
} from '#root/src/util'
import type {
    AccCascadeEntry,
    AccModuleSettings,
    AccResource,
    AccSensorGroup,
} from '#types'

const SCOPE = 'AccRecording'

/**
 * Length (seconds) of each stethoscope synthesis window. Stethoscope audio is time-preserving, so its buffer length
 * equals the synthesised range; rendering it in bounded windows that continue automatically keeps memory bounded
 * regardless of recording length.
 */
const STETHOSCOPE_WINDOW_SECONDS = 60

/**
 * Map a sensor-group id to a short display prefix. `leftwrist` → `L Wrist`,
 * `rightankle` → `R Ankle`, `wrist` → `Wrist`. Inputs without a `left` /
 * `right` prefix come through unchanged with the first letter capitalised.
 */
function prettyGroupPrefix (groupId: string): string {
    const lower = groupId.toLowerCase()
    let side = ''
    let rest = groupId
    if (lower.startsWith('left')) {
        side = 'L'
        rest = groupId.slice(4)
    } else if (lower.startsWith('right')) {
        side = 'R'
        rest = groupId.slice(5)
    }
    const restLabel = rest ? rest.charAt(0).toUpperCase() + rest.slice(1).toLowerCase() : ''
    return [side, restLabel].filter(Boolean).join(' ')
}

export default class AccRecording extends GenericBiosignalResource implements AccResource {
    /** ACC recording events (not including property change events). */
    static readonly EVENTS = { ...GenericBiosignalResource.EVENTS, ...AccEvents }

    /** Player for the synthesised entrainment audio. */
    protected _audio: BiosignalAudio
    /** Whether stethoscope playback should auto-continue into the next window when the current one ends. */
    protected _audioContinue = false
    /** Recording time (seconds) at which the currently loaded audio buffer begins. */
    protected _audioWindowStart = 0
    protected _headers: BiosignalHeaderRecord
    protected _isAudioPlaying = false
    protected _recMontageTemplate: BiosignalMontageTemplate | null = null
    protected _samplingRate: number | null = null
    protected _sensorGroups: AccSensorGroup[] = []
    protected _service: AccService | null = null
    /** Shorthand for accessing ACC module settings from the global runtime. */
    #SETTINGS = (window.__EPICURRENTS__?.RUNTIME?.SETTINGS.modules.acc as AccModuleSettings) || null

    /**
     * Construct the ACC recording from the importer's parsed CSV stream. The
     * `channels` descriptors are wrapped in `AccSourceChannel` and their
     * baseline offsets are distributed evenly straight away — ACC defaults to
     * raw display (no montage) where the `GenericBiosignalMontage` path that
     * normally distributes baseline offsets never runs. The service captures
     * `fileWorker` for the rest of the resource's lifetime; the activation
     * handler installed here wires SAB or fallback-cache setup, default-montage
     * activation, and the cache-fill kickoff together.
     * @param name - Human-readable resource name; surfaced in the dataset navigator.
     * @param channels - Per-column descriptors the CSV importer wrote into `study.meta.channels`.
     * @param header - Parsed biosignal header carrying duration, sampling rate, and the per-channel layout.
     * @param fileWorker - Worker that runs the CSV reader off the main thread.
     * @param memoryManager - Optional SAB manager; when present and `useMemoryManager` is on, signals
     *                       cache into a shared buffer instead of the main-thread fallback cache.
     * @param config - Optional resource overrides (`modality`, `formatHeader`); empty by default.
     */
    constructor (
        name: string,
        channels: BiosignalChannel[],
        header: BiosignalHeaderRecord,
        fileWorker: Worker,
        memoryManager?: MemoryManager,
        config: BiosignalConfig = {} as BiosignalConfig,
    ) {
        super(name, config?.modality || 'acc')
        if (!this.#SETTINGS) {
            Log.error(`ACC settings not found in the global Epicurrents runtime.`, SCOPE)
        }
        this._headers = header
        if (memoryManager && this.#SETTINGS?.useMemoryManager) {
            this.setMemoryManager(memoryManager)
        }
        for (let i = 0; i < channels.length; i++) {
            const ch = channels[i]
            this._channels.push(new AccSourceChannel(
                ch.name || `ch_${i}`,
                ch.label || `ACC ${i + 1}`,
                i,
                ch.samplingRate || 0,
                ch.visible ?? true,
                ch.unit || 'g',
                ch,
            ))
        }
        // ACC source channels render raw (no montage), so the
        // `GenericBiosignalMontage` path that normally distributes baseline
        // offsets never runs. Place each source channel at an equal vertical
        // slot now.
        calculateSignalOffsets(this._channels)
        // Service owns the worker for the rest of the resource's lifetime.
        this._service = new AccService(this, fileWorker, this._memoryManager || undefined)
        this._audio = new BiosignalAudio(name)
        this._audio.addPlayEndedCallback(() => this._onAudioEnded())
        this._samplingRate = header.maxSamplingRate || channels[0]?.samplingRate || 0
        this._dataDuration = header.dataDuration || header.duration || 0
        this._totalDuration = header.duration || this._dataDuration
        this._startTime = header.recordingStartTime ?? null
        this._state = 'loading'
        this.addEventListener(AssetEvents.DEACTIVATE, async () => {
            if (this.#SETTINGS?.unloadOnClose && this._service?.isReady) {
                await this.unload()
            }
        }, this.id)
        this.addEventListener(AssetEvents.ACTIVATE, async () => {
            if (!this._isActive) {
                return
            }
            if (!this._service?.isReady && this._state === 'ready') {
                this.dispatchEvent(BiosignalResourceEvents.SIGNAL_CACHING_COMPLETE, 'before')
                if (this._memoryManager) {
                    let totalMem = 4
                    const dataFieldsLen = BiosignalMutex.SIGNAL_DATA_POS
                    for (const chan of this.channels) {
                        totalMem += chan.samplingRate * this._totalDuration + dataFieldsLen
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
                // Default montage ('rec') needs the mutex/cache in place;
                // adding it before `cacheSignals` ensures it's the active
                // montage by the time signals start arriving.
                await this._applyDefaultMontages()
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

    get isAudioPlaying (): boolean {
        return this._isAudioPlaying
    }
    set isAudioPlaying (playing: boolean) {
        this._setPropertyValue('isAudioPlaying', playing)
    }

    get playbackPosition (): number {
        return this._audioWindowStart + this._audio.currentTime
    }

    get sensorGroups (): AccSensorGroup[] {
        return this._sensorGroups
    }

    /**
     * Build and activate the default `rec` montage. Runs from the ACTIVATE
     * handler after the SAB is in place — `addMontage` needs the worker mutex
     * to commission the montage processor.
     */
    protected async _applyDefaultMontages (): Promise<void> {
        if (!this._recMontageTemplate || !this._setup) {
            return
        }
        const created = await this.addMontage('rec', 'As recorded', this._setup, this._recMontageTemplate)
        if (created) {
            await this.setActiveMontage('rec')
            Log.debug(`Activated default 'rec' montage.`, SCOPE)
        }
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
        const groups = parseSensorGroups(this._channels, {
            pattern: settings?.channelNamePattern,
            sideMap: settings?.sideMap,
        })
        this._sensorGroups = groups
        const derivations = magnitudeDerivationsForGroups(groups)
        // Index each derivation by its source-channel name so we can wire the
        // friendly label back onto the matching sensor group below.
        const derivByGroup = new Map<string, typeof derivations[number]>()
        for (const d of derivations) {
            // Derivation names look like `<groupId>_mag` — recover the group.
            const groupId = d.name.endsWith('_mag') ? d.name.slice(0, -4) : d.name
            derivByGroup.set(groupId, d)
        }
        setup.derivations = derivations
        // Expose each materialised derivation as a setup channel so the montage
        // template can reference it by name (`mapMontageChannels` searches
        // `setup.channels` only — derivations declared on `setup.derivations`
        // are otherwise invisible to montages). The index points at the cache
        // slot the materialisation pipeline writes the magnitude into; slots
        // are allocated source-first, derivations after.
        const sourceCount = this._channels.length
        for (let i = 0; i < derivations.length; i++) {
            const deriv = derivations[i]
            setupChannels.push({
                active: sourceCount + i,
                averaged: false,
                displayPolarity: 0,
                index: sourceCount + i,
                label: deriv.label,
                laterality: deriv.laterality,
                modality: deriv.modality,
                name: deriv.name,
                reference: [],
                samplingRate: deriv.samplingRate ?? 0,
                scale: 0,
                unit: deriv.unit,
            })
        }
        setup.channels = setupChannels
        this.setup = setup
        // Build the default `rec` montage template — one row per source axis and
        // one per magnitude derivation, with friendly labels (`L Wrist X`,
        // `R Wrist |a|`, etc.). The montage activation in `_applyDefaultMontages`
        // uses this template; storing it on the resource keeps the label
        // generation in one place.
        this._recMontageTemplate = this._buildRecMontageTemplate(groups, derivByGroup)
        // Also expose the magnitude derivations as source channels so the raw
        // (no-montage) view shows them too. Mirrors the cache slot layout.
        for (let i = 0; i < derivations.length; i++) {
            const deriv = derivations[i]
            this._channels.push(new AccSourceChannel(
                deriv.name,
                deriv.label,
                sourceCount + i,
                deriv.samplingRate ?? 0,
                true,
                deriv.unit,
                { laterality: deriv.laterality },
            ))
        }
        calculateSignalOffsets(this._channels)
        Log.debug(
            `ACC setup applied: ${groups.length} sensor group(s), ` +
            `${derivations.length} magnitude derivation(s).`,
            SCOPE,
        )
    }

    /**
     * Compose the `rec` montage template for the resolved sensor groups. Each
     * 3-axis group contributes three axis rows plus one magnitude row; groups
     * without a magnitude derivation (incomplete 3-axis coverage) get only
     * their axes. Friendly labels use {@link prettyGroupPrefix} to produce
     * short, plot-friendly text.
     */
    protected _buildRecMontageTemplate (
        groups: AccSensorGroup[],
        derivByGroup: Map<string, { name: string, label: string, samplingRate?: number, laterality: BiosignalLaterality, unit: string }>,
    ): BiosignalMontageTemplate {
        const channels: BiosignalChannelTemplate[] = []
        const electrodes: string[] = []
        // `layout` is the number of channel rows per visual group — drives the
        // baseline-offset computation in `calculateSignalOffsets`. Without it
        // the offset routine sees an empty layout, leaves every channel at the
        // default baseline, and the rows stack on top of each other. Each
        // sensor group contributes its axes + (optional) magnitude as one
        // visual group with a small inter-group gap.
        const layout: number[] = []
        for (const group of groups) {
            const prefix = prettyGroupPrefix(group.id)
            const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z']
            let perGroup = 0
            for (const axis of axes) {
                const idx = group.axes[axis]
                if (idx === null) {
                    continue
                }
                const sourceChan = this._channels[idx]
                if (!sourceChan) {
                    continue
                }
                electrodes.push(sourceChan.name)
                channels.push({
                    name: sourceChan.name,
                    label: [prefix, axis.toUpperCase()].filter(Boolean).join(' '),
                    active: sourceChan.name,
                    reference: [],
                    modality: 'acc',
                    laterality: group.laterality,
                    unit: sourceChan.unit,
                } as BiosignalChannelTemplate)
                perGroup++
            }
            const deriv = derivByGroup.get(group.id)
            if (deriv) {
                electrodes.push(deriv.name)
                channels.push({
                    name: deriv.name,
                    label: [prefix, '|a|'].filter(Boolean).join(' '),
                    active: deriv.name,
                    reference: [],
                    modality: 'acc',
                    laterality: group.laterality,
                    unit: deriv.unit,
                } as BiosignalChannelTemplate)
                perGroup++
            }
            if (perGroup > 0) {
                layout.push(perGroup)
            }
        }
        return {
            name: 'rec',
            label: 'As recorded',
            channels,
            electrodes,
            layout,
        } as BiosignalMontageTemplate
    }

    /**
     * Wraps the base resource's cascade-construction hook so the returned
     * montage is an `AccCascadeMontage` with `AccMontageChannel` rows. The
     * cascade reads raw signals directly via `getAllRawSignals` and bypasses
     * the montage worker entirely (see the base class for the rationale).
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
     * Index of the first magnitude-derivation channel (named `<group>_mag`) in the cached source signals, or -1 when
     * the recording has no complete 3-axis group and therefore no magnitude to sonify.
     */
    protected _magnitudeSignalIndex (): number {
        return this._channels.findIndex(channel => channel.name.endsWith('_mag'))
    }

    /**
     * Handle the player reaching the end of a buffer. In stethoscope mode the next bounded window is synthesised and
     * played automatically until the recording end is reached; otherwise (or at the end) the stopped/ended events fire.
     */
    protected async _onAudioEnded (): Promise<void> {
        if (this._audioContinue) {
            const windowLength = Math.min(STETHOSCOPE_WINDOW_SECONDS, this._dataDuration - this._audioWindowStart)
            const nextStart = this._audioWindowStart + windowLength
            if (nextStart < this._dataDuration && await this._playStethoscopeWindow(nextStart)) {
                return
            }
        }
        this._audioContinue = false
        this.isAudioPlaying = false
        this.dispatchEvent(AccRecording.EVENTS.AUDIO_PLAYBACK_ENDED)
        this.dispatchEvent(AccRecording.EVENTS.AUDIO_PLAYBACK_STOPPED)
    }

    /**
     * Synthesise and play one stethoscope window beginning at the given recording time. Sets {@link _audioWindowStart}
     * so {@link playbackPosition} stays recording-relative.
     * @param start - Recording time (seconds) the window begins at.
     * @returns Whether the window was synthesised and started.
     */
    protected async _playStethoscopeWindow (start: number): Promise<boolean> {
        const end = Math.min(start + STETHOSCOPE_WINDOW_SECONDS, this._dataDuration)
        const prepared = await this.prepareAudio([start, end], 'stethoscope')
        if (!prepared) {
            return false
        }
        this._audioWindowStart = start
        try {
            await this._audio.play(0)
            return true
        } catch (err) {
            Log.error(`Playing audio failed: ${(err as Error).message}`, SCOPE)
        }
        return false
    }

    /** Start playback of the loaded buffer from its beginning, dispatching the playback-started events. */
    protected async _startPlayback (): Promise<boolean> {
        try {
            this.dispatchPayloadEvent(
                AccRecording.EVENTS.AUDIO_PLAYBACK_STARTED,
                { position: this.playbackPosition },
                'before',
            )
            await this._audio.play(0)
            this.isAudioPlaying = true
            this.dispatchPayloadEvent(AccRecording.EVENTS.AUDIO_PLAYBACK_STARTED, { position: this.playbackPosition })
            return true
        } catch (err) {
            Log.error(`Playing audio failed: ${(err as Error).message}`, SCOPE)
        }
        return false
    }

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

    async addMontage (
        name: string,
        label: string,
        setup: BiosignalSetup | string,
        template?: BiosignalMontageTemplate,
        config?: ConfigMapChannels,
    ): Promise<BiosignalMontage | null> {
        let montage = this._montages.find(m => m.name === name) || null
        if (this._mutexProps && this._service?.bufferRangeStart === undefined) {
            Log.error(`Cannot add a montage before buffer has been initialized.`, SCOPE)
            return null
        }
        if (montage) {
            Log.debug(`Montage '${name}' already exists.`, SCOPE)
            return montage
        }
        let resolvedSetup: BiosignalSetup
        if (typeof setup === 'string') {
            if (this._setup?.name === setup) {
                resolvedSetup = this._setup
            } else {
                Log.error(`Setup '${setup}' not found.`, SCOPE)
                return null
            }
        } else {
            resolvedSetup = setup
        }
        const created = new AccMontage(
            name,
            this,
            resolvedSetup,
            template,
            this._memoryManager || undefined,
            { label } as ConfigBiosignalMontage,
        )
        created.mapChannels(config)
        if (this._mutexProps) {
            await created.setupServiceWithInputMutex(this._mutexProps)
        } else if (this._cacheProps) {
            await created.setupServiceWithCache(this._cacheProps)
        }
        created.setInterruptions(this._interruptions)
        this._setPropertyValue('montages', [...this._montages, created])
        return created
    }

    destroy (): Promise<void> {
        this._audio.destroy()
        return super.destroy()
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

    pauseAudio (): boolean {
        try {
            this.dispatchPayloadEvent(
                AccRecording.EVENTS.AUDIO_PLAYBACK_PAUSED,
                { position: this.playbackPosition },
                'before',
            )
            this._audio.pause()
            this.isAudioPlaying = false
            this.dispatchPayloadEvent(
                AccRecording.EVENTS.AUDIO_PLAYBACK_PAUSED,
                { position: this.playbackPosition },
            )
            return true
        } catch (err) {
            Log.error(`Pausing audio failed: ${(err as Error).message}`, SCOPE)
        }
        return false
    }

    async playAudio (
        position = 0,
        range?: [number, number],
        method?: AudioSynthesisMethod,
    ): Promise<boolean> {
        // Tear down any current playback so the player re-arms from the freshly synthesised buffer.
        this._audio.stop()
        if (range !== undefined) {
            // Selected segment → spectral-tone: a looping steady tone, no windowed continuation, no cursor follow.
            this._audioContinue = false
            this._audioWindowStart = 0
            const prepared = await this.prepareAudio(range, method ?? 'spectral-tone')
            if (!prepared) {
                return false
            }
            return this._startPlayback()
        }
        // No selection → stethoscope from `position`, played in bounded windows that continue automatically.
        this._audioContinue = true
        const started = await this._playStethoscopeWindow(position)
        if (started) {
            this.isAudioPlaying = true
            this.dispatchPayloadEvent(AccRecording.EVENTS.AUDIO_PLAYBACK_STARTED, { position })
        }
        return started
    }

    async prepare (options?: UrlAccessOptions): Promise<boolean> {
        if (!this._service || this._state === 'error') {
            Log.error(
                `Cannot prepare ACC recording; service is unavailable or already in an error state.`,
                SCOPE,
            )
            return false
        }
        const ok = await this._service.setupWorker(
            this._headers,
            this._source as StudyContext,
            options,
        ).then(response => {
            if (response) {
                this.totalDuration = response
                this.state = 'ready'
                return true
            }
            this._errorReason = 'Setting up worker failed'
            this.state = 'error'
            return false
        }).catch(e => {
            Log.error(`Error when preparing the worker for the ACC recording.`, SCOPE, e as Error)
            this._errorReason = 'Setting up worker failed'
            this.state = 'error'
            return false
        })
        if (ok) {
            await this._applyDefaultSetups()
        }
        return ok
    }

    /**
     * Synthesise audio from the magnitude signal and load it into the player. Picks `spectral-tone` when a segment
     * `range` is given (a steady tone from that clean window) and `stethoscope` otherwise (time-preserving
     * sonification of the whole signal); an explicit `method` overrides the selection-based default.
     * @param range - Optional [start, end] segment in seconds; when given, the default method becomes `spectral-tone`.
     * @param method - Optional explicit synthesis method key, overriding the selection-based default.
     * @returns Promise resolving true when a buffer was prepared, false when no magnitude signal is available.
     */
    async prepareAudio (range?: [number, number], method?: AudioSynthesisMethod): Promise<boolean> {
        if (!this._service) {
            return false
        }
        const magnitudeIndex = this._magnitudeSignalIndex()
        if (magnitudeIndex < 0) {
            Log.warn(`No magnitude derivation available for audio synthesis.`, SCOPE)
            return false
        }
        const signalRange = range ?? [0, this._dataDuration]
        const signals = await this._service.getSignals(signalRange)
        const magnitude = signals?.signals[magnitudeIndex]?.data
        if (!magnitude) {
            Log.warn(`Magnitude signal could not be retrieved for audio synthesis.`, SCOPE)
            return false
        }
        const chosenMethod: AudioSynthesisMethod = method ?? (range ? 'spectral-tone' : 'stethoscope')
        const synthesizer = getSynthesizer(chosenMethod)
        if (!synthesizer) {
            Log.warn(`Unknown audio synthesis method '${chosenMethod}'.`, SCOPE)
            return false
        }
        // stethoscope derives its (time-preserving) duration from the signal length; spectral-tone uses its own
        // fixed sustain — so neither needs an explicit duration here.
        const buffer = await synthesizer.synthesize([magnitude], this._samplingRate || 0)
        // spectral-tone is a steady snapshot: loop it so it sustains until stopped. stethoscope evolves over time and
        // auto-continues window by window, so it must not loop.
        this._audio.setBuffer(buffer, chosenMethod === 'spectral-tone')
        return true
    }

    async resumeAudio (): Promise<boolean> {
        if (!this._audio.hasStarted) {
            return false
        }
        try {
            await this._audio.play(0)
            this.isAudioPlaying = true
            this.dispatchPayloadEvent(AccRecording.EVENTS.AUDIO_PLAYBACK_STARTED, { position: this.playbackPosition })
            return true
        } catch (err) {
            Log.error(`Resuming audio failed: ${(err as Error).message}`, SCOPE)
        }
        return false
    }

    rewindAudio (): boolean {
        try {
            this.dispatchEvent(AccRecording.EVENTS.AUDIO_PLAYBACK_STOPPED, 'before')
            this._audioContinue = false
            this._audioWindowStart = 0
            this._audio.stop()
            this.isAudioPlaying = false
            this.dispatchEvent(AccRecording.EVENTS.AUDIO_PLAYBACK_STOPPED)
            return true
        } catch (err) {
            Log.error(`Rewinding audio failed: ${(err as Error).message}`, SCOPE)
        }
        return false
    }

    setAudioGain (gain: number): void {
        this._audio.setGain(gain)
    }
}
