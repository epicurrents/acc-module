/**
 * Epicurrents ACC runtime module.
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { logInvalidMutation } from '@epicurrents/core/runtime'
import { safeObjectFrom } from '@epicurrents/core/util'
import type {
    DataResource,
    RuntimeResourceModule,
    SafeObject,
    StateManager,
} from '@epicurrents/core/types'
import type { AccResource } from '#types'

const SCOPE = 'acc-runtime-module'

const ACC = safeObjectFrom({
    moduleName: {
        code: 'acc',
        full: 'Accelerometry',
        short: 'ACC',
    },
    async applyConfiguration (_config) {
        // No module-level configuration to apply yet — sensor groups are
        // resolved per-recording during `_applyDefaultSetups`.
    },
    setPropertyValue (
        property: string,
        value: unknown,
        resource?: DataResource,
        state?: StateManager,
    ) {
        const activeRes = resource
            ? resource as AccResource
            : state
                ? state.APP.activeDataset?.activeResources[0] as AccResource
                : null
        if (!activeRes) {
            return
        }
        if (property === 'active-montage') {
            if (
                typeof value !== 'string' &&
                typeof value !== 'number' &&
                value !== null
            ) {
                logInvalidMutation(property, value, SCOPE)
                return
            }
            if (activeRes.activeMontage !== undefined) {
                activeRes.setActiveMontage(value)
            }
        } else if (property === 'highpass-filter') {
            if (typeof value !== 'number' || value < 0) {
                logInvalidMutation(property, value, SCOPE, 'Value must be a positive number.')
                return
            }
            if (activeRes.filters?.highpass !== undefined) {
                activeRes.setHighpassFilter(value)
            }
        } else if (property === 'lowpass-filter') {
            if (typeof value !== 'number' || value < 0) {
                logInvalidMutation(property, value, SCOPE, 'Value must be a positive number.')
                return
            }
            if (activeRes.filters?.lowpass !== undefined) {
                activeRes.setLowpassFilter(value)
            }
        } else if (property === 'sensitivity') {
            if (typeof value !== 'number' || value <= 0) {
                logInvalidMutation(property, value, SCOPE, 'Value must be a positive number.')
                return
            }
            if (activeRes.sensitivity !== undefined) {
                activeRes.sensitivity = value
            }
        } else if (property === 'timebase') {
            if (typeof value !== 'number' || value <= 0) {
                logInvalidMutation(property, value, SCOPE, 'Value must be a positive number.')
                return
            }
            if (activeRes.timebase !== undefined) {
                activeRes.timebase = value
            }
        } else if (property === 'timebase-unit') {
            if (typeof value !== 'string' || value === '') {
                logInvalidMutation(property, value, SCOPE, 'Value must be a non-empty string.')
                return
            }
            if (activeRes.timebaseUnit !== undefined) {
                activeRes.timebaseUnit = value
            }
        } else {
            logInvalidMutation(property, value, SCOPE, 'Unknown property.')
        }
    },
} as SafeObject & RuntimeResourceModule)

export default ACC
