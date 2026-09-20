/**
 * Tests for the template constructors of `AccEvent` and `AccLabel`.
 *
 * The properties under test are the ones whose meaningful value is falsy. Core applies its own
 * defaults to an absent option (`visible ?? true`, and an absent label renders the annotation's
 * value), so a template field that arrives as `undefined` is indistinguishable from one that was
 * never set — which is how a deliberately hidden annotation becomes a visible one.
 *
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import AccEvent from '../src/components/AccEvent'
import AccLabel from '../src/components/AccLabel'
import type { AnnotationEventTemplate, AnnotationLabelTemplate } from '@epicurrents/core/types'

const eventTemplate = (over: Partial<AnnotationEventTemplate> = {}) => ({
    start: 0,
    duration: 1,
    label: 'Movement',
    ...over,
}) as AnnotationEventTemplate

const labelTemplate = (over: Partial<AnnotationLabelTemplate> = {}) => ({
    value: 'artefact',
    label: 'Artefact',
    ...over,
}) as AnnotationLabelTemplate

describe('AccEvent.fromTemplate', () => {
    it('preserves an explicitly hidden event', () => {
        expect(AccEvent.fromTemplate(eventTemplate({ visible: false })).visible).toBe(false)
    })

    it('defaults to visible when the template does not say', () => {
        expect(AccEvent.fromTemplate(eventTemplate()).visible).toBe(true)
    })

    it('preserves a fully transparent event', () => {
        expect(AccEvent.fromTemplate(eventTemplate({ opacity: 0 })).opacity).toBe(0)
    })

    it('preserves a zero priority', () => {
        expect(AccEvent.fromTemplate(eventTemplate({ priority: 0 })).priority).toBe(0)
    })

    it('carries the template start, duration and label through', () => {
        const event = AccEvent.fromTemplate(eventTemplate({ start: 12, duration: 3 }))
        expect(event.start).toBe(12)
        expect(event.duration).toBe(3)
        expect(event.label).toBe('Movement')
    })
})

describe('AccLabel.fromTemplate', () => {
    it('preserves an explicitly hidden label', () => {
        expect(AccLabel.fromTemplate(labelTemplate({ visible: false })).visible).toBe(false)
    })

    it('defaults to visible when the template does not say', () => {
        expect(AccLabel.fromTemplate(labelTemplate()).visible).toBe(true)
    })

    it('keeps an explicitly empty label blank rather than falling back to the value', () => {
        expect(AccLabel.fromTemplate(labelTemplate({ label: '' })).label).toBe('')
    })

    it('renders the value when the template carries no label at all', () => {
        const tpl = labelTemplate()
        delete (tpl as { label?: string }).label
        expect(AccLabel.fromTemplate(tpl).label).toBe('artefact')
    })

    it('preserves a zero priority', () => {
        expect(AccLabel.fromTemplate(labelTemplate({ priority: 0 })).priority).toBe(0)
    })
})
