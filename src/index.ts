/**
 * Public surface of the ACC module.
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import AccCascadeMontage from '#components/AccCascadeMontage'
import AccEvent from '#components/AccEvent'
import { AccEvents } from '#events'
import AccLabel from '#components/AccLabel'
import AccMontage from '#components/AccMontage'
import AccMontageChannel from '#components/AccMontageChannel'
import AccRecording from './AccRecording'
import AccService from '#service/AccService'
import AccSourceChannel from '#components/AccSourceChannel'
import AccStudyLoader from '#loader/AccStudyLoader'
import runtime from './runtime'
import settings from './config'
import {
    magnitudeDerivationsForGroups,
    parseSensorGroups,
} from '#root/src/util'

const modality = 'acc'

export {
    AccCascadeMontage,
    AccEvent,
    AccEvents,
    AccLabel,
    AccMontage,
    AccMontageChannel,
    AccRecording,
    AccService,
    AccSourceChannel,
    AccStudyLoader,
    magnitudeDerivationsForGroups,
    modality,
    parseSensorGroups,
    runtime,
    settings,
}
export type {
    AccCascadeEntry,
    AccDataService,
    AccModuleSettings,
    AccResource,
    AccSensorGroup,
    AccStudyContext,
} from '#types'
export type { AccModuleEvent } from '#events'
