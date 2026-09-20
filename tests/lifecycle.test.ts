/**
 * Tests for `AccRecording`'s preparation and montage lifecycle.
 *
 * Both methods are exercised through `AccRecording.prototype` against a stub carrying only the
 * members they read. What is being pinned is ordering and assignment rather than signal maths, so
 * booting a real resource (worker, memory manager, SAB) would add no coverage.
 *
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import AccRecording from '../src/AccRecording'
import { AssetEvents } from '@epicurrents/core/events'

vi.mock('scoped-event-log', () => ({
    Log: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

const callPrototype = (method: 'prepare' | '_applyDefaultMontages', context: object, ...args: unknown[]) =>
    (AccRecording.prototype as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)
        [method].call(context, ...args)

describe('_applyDefaultMontages', () => {
    beforeEach(() => { vi.clearAllMocks() })

    const makeContext = (created: object | null = { name: 'rec' }) => ({
        _recMontageTemplate: { channels: [] },
        _setup: { name: 'acc' },
        _recordMontage: null as object | null,
        addMontage: vi.fn().mockResolvedValue(created),
        setActiveMontage: vi.fn().mockResolvedValue(undefined),
    })

    it('records the created montage as the as-recorded montage', async () => {
        const context = makeContext()
        await callPrototype('_applyDefaultMontages', context)
        // Left null, a channel-scoped annotation resolves to no channels and is never drawn.
        expect(context._recordMontage).toEqual({ name: 'rec' })
    })

    it('activates the montage it created', async () => {
        const context = makeContext()
        await callPrototype('_applyDefaultMontages', context)
        expect(context.setActiveMontage).toHaveBeenCalledWith('rec')
    })

    it('leaves the as-recorded montage unset when creation fails', async () => {
        const context = makeContext(null)
        await callPrototype('_applyDefaultMontages', context)
        expect(context._recordMontage).toBe(null)
        expect(context.setActiveMontage).not.toHaveBeenCalled()
    })

    it('does nothing without a template or a setup', async () => {
        const noTemplate = { ...makeContext(), _recMontageTemplate: null }
        await callPrototype('_applyDefaultMontages', noTemplate)
        expect(noTemplate.addMontage).not.toHaveBeenCalled()
        const noSetup = { ...makeContext(), _setup: null }
        await callPrototype('_applyDefaultMontages', noSetup)
        expect(noSetup.addMontage).not.toHaveBeenCalled()
    })
})

describe('prepare', () => {
    beforeEach(() => { vi.clearAllMocks() })

    /**
     * Records the order in which readiness is advertised and setups are attached, so the test can
     * assert on their sequence rather than only their occurrence.
     */
    const makeContext = (options: { setupWorkerResponse?: number, isActive?: boolean } = {}) => {
        const order: string[] = []
        const context = {
            _headers: {},
            _source: {},
            _formatHeader: null,
            _errorReason: '',
            _isActive: options.isActive ?? false,
            _state: 'loading',
            _service: {
                isReady: false,
                setupWorker: vi.fn().mockResolvedValue(options.setupWorkerResponse ?? 120),
            },
            totalDuration: 0,
            get state () { return this._state },
            set state (value: string) {
                this._state = value
                order.push(`state:${value}`)
            },
            _applyDefaultSetups: vi.fn(() => {
                order.push('setups')
                return Promise.resolve()
            }),
            dispatchEvent: vi.fn((event: string, phase: string) => {
                order.push(`dispatch:${event}:${phase}`)
            }),
        }
        return { context, order }
    }

    it('attaches the setups before advertising readiness', async () => {
        const { context, order } = makeContext()
        await callPrototype('prepare', context, {})
        // A consumer that sees `state === 'ready'` must be able to trust that `_setup` is populated:
        // the activation handler budgets SAB memory from its derivations and builds montages from
        // the template, and reaching it in between leaves both silently empty.
        expect(order.indexOf('setups')).toBeLessThan(order.indexOf('state:ready'))
    })

    it('reports success and records the duration the worker returned', async () => {
        const { context } = makeContext({ setupWorkerResponse: 300 })
        await expect(callPrototype('prepare', context, {})).resolves.toBe(true)
        expect(context.totalDuration).toBe(300)
        expect(context._state).toBe('ready')
    })

    it('re-dispatches ACTIVATE when the resource was activated before it was ready', async () => {
        const { context, order } = makeContext({ isActive: true })
        await callPrototype('prepare', context, {})
        expect(context.dispatchEvent).toHaveBeenCalledWith(AssetEvents.ACTIVATE, 'after')
        // Only once readiness is real, or the handler's own guard turns it away again.
        expect(order.indexOf('state:ready'))
            .toBeLessThan(order.indexOf(`dispatch:${AssetEvents.ACTIVATE}:after`))
    })

    it('does not re-dispatch ACTIVATE for a resource that was never activated', async () => {
        const { context } = makeContext({ isActive: false })
        await callPrototype('prepare', context, {})
        expect(context.dispatchEvent).not.toHaveBeenCalled()
    })

    it('does not re-dispatch ACTIVATE when the service is already set up', async () => {
        const { context } = makeContext({ isActive: true })
        context._service.isReady = true
        await callPrototype('prepare', context, {})
        expect(context.dispatchEvent).not.toHaveBeenCalled()
    })

    it('errors without attaching setups when the worker reports failure', async () => {
        const { context, order } = makeContext({ setupWorkerResponse: 0 })
        await expect(callPrototype('prepare', context, {})).resolves.toBe(false)
        expect(context._state).toBe('error')
        expect(order).not.toContain('setups')
    })
})
