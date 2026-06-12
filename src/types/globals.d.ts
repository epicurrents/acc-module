/**
 * Global property type declarations for the ACC module.
 * @package    @epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

/* eslint-disable */
type EpicurrentsGlobal = {
    APP: unknown | null
    EVENT_BUS: import('scoped-event-bus').ScopedEventBus | null
    RUNTIME: import('@epicurrents/core/dist/types/application').StateManager
}

declare global {
    let __webpack_public_path__: string
    interface Window {
        __EPICURRENTS__: EpicurrentsGlobal
    }
}
export {}
