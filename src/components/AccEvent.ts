/**
 * Epicurrents ACC event.
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericBiosignalEvent } from '@epicurrents/core'
import type {
    AnnotationEventTemplate,
    BiosignalAnnotationEventOptions,
    SettingsColor,
} from '@epicurrents/core/dist/types'

export default class AccEvent extends GenericBiosignalEvent {

    public static fromTemplate (tpl: AnnotationEventTemplate) {
        return new AccEvent(
            tpl.start, tpl.duration, GenericBiosignalEvent.labelFromTemplate(tpl),
            {
                annotator: tpl.annotator || undefined,
                background: tpl.background || undefined,
                channels: tpl.channels || undefined,
                class: tpl.class || undefined,
                color: tpl.color as SettingsColor || undefined,
                codes: tpl.codes || undefined,
                label: tpl.label || undefined,
                opacity: tpl.opacity || undefined,
                priority: tpl.priority || undefined,
                text: tpl.text || undefined,
                visible: tpl.visible || undefined,
            },
        )
    }

    constructor (
        start: number,
        duration: number,
        label: string,
        options?: BiosignalAnnotationEventOptions,
    ) {
        super('AccEvent', start, duration, label, options)
    }
}
