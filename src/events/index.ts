/**
 * ACC module events.
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import type { BroadcastStateEvent, EventWithPayload } from '@epicurrents/core/dist/types/event'

/**
 * ACC module events.
 */
export enum AccEvents {
    /** Audio playback ended due to reaching the end of the synthesised buffer. */
    AUDIO_PLAYBACK_ENDED = 'acc-audio-playback-ended',
    /** Audio playback paused. */
    AUDIO_PLAYBACK_PAUSED = 'acc-audio-playback-paused',
    /** Audio playback started. */
    AUDIO_PLAYBACK_STARTED = 'acc-audio-playback-started',
    /** Audio playback stopped. */
    AUDIO_PLAYBACK_STOPPED = 'acc-audio-playback-stopped',
}

export type AccModuleEvent = {
    /** ACC audio playback has ended due to reaching the end of the synthesised buffer. */
    [AccEvents.AUDIO_PLAYBACK_ENDED]: BroadcastStateEvent
    /** ACC audio playback is paused at the given position. */
    [AccEvents.AUDIO_PLAYBACK_PAUSED]: EventWithPayload<{ position: number }>
    /** ACC audio playback is started from the given position. */
    [AccEvents.AUDIO_PLAYBACK_STARTED]: EventWithPayload<{ position: number }>
    /** ACC audio playback is stopped. */
    [AccEvents.AUDIO_PLAYBACK_STOPPED]: BroadcastStateEvent
}
