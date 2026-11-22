/**
 * Tests for `AccRecording`'s load and montage lifecycle.
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

vi.mock('scoped-event-log', () => ({
    Log: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

const callPrototype = (method: '_load' | '_applyDefaultMontages', context: object, ...args: unknown[]) =>
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

describe('_load', () => {
    beforeEach(() => { vi.clearAllMocks() })

    /**
     * Records the order in which the worker is set up and the setups are attached, so the test can
     * assert on their sequence rather than only their occurrence.
     */
    const makeContext = (options: { setupWorkerResponse?: number, worker?: object | null } = {}) => {
        const order: string[] = []
        const service = {
            isReady: false,
            setupWorker: vi.fn(() => {
                order.push('worker')
                return Promise.resolve(options.setupWorkerResponse ?? 120)
            }),
        }
        const context = {
            name: 'acc',
            _headers: {},
            _source: { name: 'acc', files: [], meta: { channels: [], header: {} } } as object | null,
            _formatHeader: null,
            _errorReason: '',
            _getWorker: vi.fn(() => (options.worker === undefined ? {} : options.worker)),
            // Core's check of a load superseded by an unload or a destroy, which `_load` reads after each await.
            _isLoadSuperseded (generation: number) {
                return generation !== context._loadGeneration || context._state === 'destroyed'
            },
            _loadGeneration: 0,
            _loadRun: null,
            _memoryManager: null,
            _releaseSupersededService: vi.fn(),
            _readSource: vi.fn(),
            _service: service as typeof service | null,
            _state: 'loading',
            totalDuration: 0,
            _applyDefaultSetups: vi.fn(() => {
                order.push('setups')
                return Promise.resolve()
            }),
        }
        return { context, order, service }
    }

    it('attaches the setups once the worker has answered, before the load resolves', async () => {
        const { context, order } = makeContext()
        await expect(callPrototype('_load', context, {})).resolves.toBe(true)
        // The load resolving is what makes the resource ready, and a consumer that sees `ready` must be
        // able to trust that `_setup` is populated: activation budgets SAB memory from its derivations
        // and builds montages from the template, and reaching it before leaves both silently empty.
        expect(order).toEqual(['worker', 'setups'])
        // Readiness is the lifecycle's to set, once the load has resolved.
        expect(context._state).toBe('loading')
    })

    it('records the duration the worker returned', async () => {
        const { context } = makeContext({ setupWorkerResponse: 300 })
        await callPrototype('_load', context, {})
        expect(context.totalDuration).toBe(300)
    })

    it('fails with a reason, without attaching setups, when the worker reports failure', async () => {
        const { context, order } = makeContext({ setupWorkerResponse: 0 })
        await expect(callPrototype('_load', context, {})).resolves.toBe(false)
        expect(context._errorReason).toBe('Setting up worker failed')
        expect(order).not.toContain('setups')
    })

    it('fails with a reason when setting up the worker throws', async () => {
        const { context, service } = makeContext()
        service.setupWorker.mockRejectedValueOnce(new Error('no file'))
        await expect(callPrototype('_load', context, {})).resolves.toBe(false)
        expect(context._errorReason).toBe('Setting up worker failed')
    })

    it('creates the service from the worker it asks for when it has none', async () => {
        const { context } = makeContext({ worker: null })
        context._service = null
        await expect(callPrototype('_load', context, {})).resolves.toBe(false)
        expect(context._getWorker).toHaveBeenCalledTimes(1)
        expect(context._errorReason).toBe('No file worker')
    })

    it('reads the study of a listed recording before it sets up the worker', async () => {
        const { context } = makeContext()
        context._headers = null as unknown as object
        await callPrototype('_load', context, {})
        expect(context._readSource).toHaveBeenCalledWith(context._source)
    })

    it('fails with a reason when the study lacks its channels or header', async () => {
        const { context, service } = makeContext()
        context._source = { name: 'acc', files: [], meta: { channels: [] } }
        await expect(callPrototype('_load', context, {})).resolves.toBe(false)
        expect(context._errorReason).toBe('Recording study is incomplete')
        expect(service.setupWorker).not.toHaveBeenCalled()
    })

    it('sets nothing up on a recording destroyed while its worker was being set up', async () => {
        const { context, order, service } = makeContext()
        service.setupWorker.mockImplementationOnce(() => {
            context._state = 'destroyed'
            return Promise.resolve(120)
        })
        await expect(callPrototype('_load', context, {})).resolves.toBe(false)
        expect(context.totalDuration).toBe(0)
        expect(order).not.toContain('setups')
        expect(context._errorReason).toBe('')
    })

    it('sets nothing up on a recording whose service went while its worker was being set up', async () => {
        const { context, order, service } = makeContext()
        service.setupWorker.mockImplementationOnce(() => {
            context._service = null
            return Promise.resolve(0)
        })
        await expect(callPrototype('_load', context, {})).resolves.toBe(false)
        expect(order).not.toContain('setups')
        expect(context._errorReason).toBe('')
    })

    it('sets nothing up on a recording unloaded while its worker was being set up', async () => {
        const { context, order, service } = makeContext()
        service.setupWorker.mockImplementationOnce(() => {
            context._loadGeneration++
            context._state = 'added'
            return Promise.resolve(120)
        })
        await expect(callPrototype('_load', context, {})).resolves.toBe(false)
        expect(context.totalDuration).toBe(0)
        expect(order).not.toContain('setups')
        // The state and the reason are left to the unload.
        expect(context._state).toBe('added')
        expect(context._errorReason).toBe('')
        expect(context._releaseSupersededService).toHaveBeenCalledTimes(1)
    })

    it('does not report a recording destroyed while its setups were attached as loaded', async () => {
        const { context } = makeContext()
        context._applyDefaultSetups.mockImplementationOnce(() => {
            context._state = 'destroyed'
            return Promise.resolve()
        })
        await expect(callPrototype('_load', context, {})).resolves.toBe(false)
    })
})
