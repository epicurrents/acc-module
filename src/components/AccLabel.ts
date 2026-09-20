/**
 * Epicurrents ACC label.
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { ResourceLabel } from '@epicurrents/core'
import type { AnnotationLabelTemplate, AnnotationOptions } from '@epicurrents/core/types'

const SCOPE = 'AccLabel'

export default class AccLabel extends ResourceLabel {

    public static fromTemplate (tpl: AnnotationLabelTemplate) {
        return new AccLabel(tpl.value, {
            annotator: tpl.annotator ?? undefined,
            class: tpl.class ?? undefined,
            codes: tpl.codes ?? undefined,
            label: tpl.label ?? undefined,
            locked: tpl.locked ?? undefined,
            priority: tpl.priority ?? undefined,
            text: tpl.text ?? undefined,
            visible: tpl.visible ?? undefined,
        })
    }

    constructor (
        value: boolean | number | number[] | string | string[] | null,
        options?: AnnotationOptions,
    ) {
        super(SCOPE, value, options)
    }
}
