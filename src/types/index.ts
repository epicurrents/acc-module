/**
 * Public type surface of the ACC module.
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import type {
    AudioSynthesisMethod,
    BaseModuleSettings,
    BiosignalDataService,
    BiosignalLaterality,
    BiosignalResource,
    CommonBiosignalSettings,
    StudyContext,
} from '@epicurrents/core/types'

/** The service contract an ACC resource's data service fulfils. Accelerometry adds no members of
 * its own, so this is core's biosignal service surface under the name the module exports. */
export type AccDataService = BiosignalDataService

/**
 * Sampling-rate convention for accelerometry magnitude — same as the inputs
 * (core's pipeline materialises one sample per input sample). No upsampling.
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
    /**
     * Display unit shared by the group's axes, empty when they disagree or declare none. Samples
     * are stored in SI regardless; this is the unit a consumer renders against, and a derived
     * signal has to carry the same one as its inputs to share their scale.
     */
    unit: string
}

export interface AccResource extends BiosignalResource {
    /** Whether the entrainment audio is currently playing. */
    isAudioPlaying: boolean
    /** Current audio playback position in seconds. */
    playbackPosition: number
    /**
     * Sensor groups derived from the channel-label parse, populated during
     * `_applyDefaultSetups()`. Empty when no group resolves all three axes.
     */
    sensorGroups: AccSensorGroup[]
    /**
     * Register a cascade montage per entry. The first candidate name that
     * resolves against the recording's setup (matched on derivations first,
     * then on source channels by either `name` or `label`) wins; per-entry
     * display defaults (`sensitivity`, `highpass`, `lowpass`) are applied to the
     * created cascade so the initial view is usable without further fiddling. ACC only ever has one setup, so the lookup runs
     * directly against `this.setup`.
     * @param entries - Declarative cascade definitions; see {@link AccCascadeEntry}.
     * @returns The list of cascade montage names that were actually added —
     *          entries whose candidates did not resolve are silently skipped.
     */
    addCascadeMontagesFromEntries (entries: AccCascadeEntry[]): Promise<string[]>
    /**
     * Pause audio playback.
     * @returns Whether the pause succeeded.
     */
    pauseAudio (): boolean
    /**
     * Start audio playback from the given position, synthesising the buffer first when a selection or method is
     * supplied or none is loaded yet. A `range` selects `spectral-tone`, its absence `stethoscope`.
     * @param position - Playback start position in seconds (default 0).
     * @param range - Optional selected segment in seconds; triggers (re)synthesis with `spectral-tone`.
     * @param method - Optional explicit method override.
     * @returns Whether playback started.
     */
    playAudio (position?: number, range?: [number, number], method?: AudioSynthesisMethod): Promise<boolean>
    /**
     * Play a pre-synthesised buffer on a loop through the shared audio player. Pairs with
     * {@link synthesizeSegment}: the caller renders the tone (and can draw its waveform), then hands it here.
     * @param buffer - The rendered audio buffer to loop.
     * @returns Whether playback started.
     */
    playBuffer (buffer: AudioBuffer): Promise<boolean>
    /**
     * Synthesise audio from the magnitude signal and load it into the player. A `range` selects `spectral-tone`,
     * its absence `stethoscope`; an explicit `method` overrides the default.
     * @param range - Optional [start, end] segment in seconds.
     * @param method - Optional explicit synthesis method key.
     * @returns Whether a buffer was prepared (false when no magnitude signal is available).
     */
    prepareAudio (range?: [number, number], method?: AudioSynthesisMethod): Promise<boolean>
    /**
     * Resume playback paused with {@link pauseAudio}, without re-synthesising.
     * @returns Whether playback resumed (false when nothing is paused).
     */
    resumeAudio (): Promise<boolean>
    /**
     * Stop audio playback and rewind to the start.
     * @returns Whether it succeeded.
     */
    rewindAudio (): boolean
    /**
     * Set the audio gain.
     * @param gain - Gain factor applied to the player output.
     */
    setAudioGain (gain: number): void
    /**
     * Set the audio playback-rate multiplier live (1 = native). Shifts the pitch of a looping tone without
     * re-rendering or restarting it.
     * @param rate - Playback-rate multiplier (> 0).
     */
    setAudioPlaybackRate (rate: number): void
    /**
     * Synthesise a steady spectral tone from a pre-loaded signal segment and return the rendered buffer without
     * playing it (the caller draws it and hands it to {@link playBuffer}). An explicit `speedUp` scales every peak
     * by the same fixed multiplier so pitch tracks the tremor frequency; omitted falls back to the synthesizer's
     * target fundamental.
     * @param signal - Time-domain samples of the segment to sonify.
     * @param samplingRate - Sampling rate of `signal` in Hz.
     * @param speedUp - Fixed frequency multiplier.
     * @returns The rendered buffer, or null when nothing could be synthesised.
     */
    synthesizeSegment (signal: Float32Array, samplingRate: number, speedUp?: number): Promise<AudioBuffer | null>
}

/**
 * ACC study context with the meta properties every accelerometry recording carries.
 * `channels` and `header` are populated by the CSV importer's full-file parse;
 * the convenience fields (`duration`, `nChannels`, `samplingRate`) mirror the
 * same values for callers that want them without going through `header`.
 */
export type AccStudyContext = StudyContext & {
    meta: StudyContext['meta'] & {
        duration: number
        nChannels: number
        samplingRate: number
    }
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
}
