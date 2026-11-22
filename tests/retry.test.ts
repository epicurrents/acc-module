/**
 * Tests for what a failed or interrupted attempt leaves behind on an ACC recording, through the real application and
 * the real loader: a recording whose load fails is deactivated and loads again on a retry with nothing of the failed
 * attempt left alive, and a cache setup overtaken by an unload stops where it is.
 *
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Epicurrents } from '@epicurrents/core'
import type { MediaDataset, StudyContext } from '@epicurrents/core/types'
import { Log } from 'scoped-event-log'
import AccRecording from '../src/AccRecording'
import AccStudyLoader from '../src/loader/AccStudyLoader'
import AccService from '../src/service/AccService'

// The real service is created on load, and it registers its worker with the log.
vi.mock('scoped-event-log', () => ({
    Log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), registerWorker: vi.fn(), warn: vi.fn() },
}))

const workerStub = () => ({
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    postMessage: vi.fn(),
    terminate: vi.fn(),
} as unknown as Worker)

const CHANNELS = ['wrist_x', 'wrist_y', 'wrist_z'].map(name => ({ name, label: name, samplingRate: 50, unit: 'g' }))

/** An importer that, like the CSV importer, declares no modalities and fills the study it reads. */
const importerDouble = () => {
    const importer = {
        name: 'AccImporter',
        study: null as StudyContext | null,
        studyLoader: null as unknown,
        getFileTypeWorker: vi.fn(workerStub),
        importUrl: vi.fn(async (url: string) => {
            importer.study!.meta = {
                channels: CHANNELS,
                header: { dataDuration: 60, maxSamplingRate: 50, recordingStartTime: null, totalDuration: 60 },
            }
            importer.study!.files = [{ role: 'data', url } as StudyContext['files'][number]]
            return true
        }),
        isSupportedModality: () => false,
        matchName: () => true,
        registerMemoryManager: vi.fn(),
        registerStudy: (study: StudyContext) => {
            importer.study = study
        },
    }
    return importer
}

/** A promise and the function that resolves it. */
const gate = <T>() => {
    let open = (_value: T) => {}
    const closed = new Promise<T>(resolve => {
        open = resolve
    })
    return { closed, open }
}

type Internals = {
    _applyDefaultMontages: () => Promise<void>
    _completeSetup: () => Promise<void>
    _service: AccService | null
    _setupRun: Promise<void> | null
}

describe('an ACC recording after a failed or interrupted attempt', () => {
    let app: Epicurrents
    let dataset: MediaDataset
    let importer: ReturnType<typeof importerDouble>

    const list = () => app.listStudy(
        { loader: 'acc/url', name: 'Listed', source: 'blob:acc' }, { dataset }
    ) as AccRecording

    beforeEach(() => {
        ;(window as unknown as { __EPICURRENTS__: undefined }).__EPICURRENTS__ = undefined
        app = new Epicurrents()
        app.runtime.APP.datasets.length = 0
        app.runtime.APP.activeDataset = null
        app.registerModule('acc', { runtime: {}, settings: {} } as never)
        importer = importerDouble()
        app.registerStudyImporter('acc/url', 'ACC', 'url', new AccStudyLoader('AccLoader', importer as never))
        dataset = app.createDataset('dataset', true)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('is deactivated when its load fails, and loads on a new service when it is selected again', async () => {
        const setupWorker = vi.spyOn(AccService.prototype, 'setupWorker')
            .mockResolvedValueOnce(0)
            .mockResolvedValue(60)
        const destroy = vi.spyOn(AccService.prototype, 'destroy').mockResolvedValue(undefined)
        const listed = list()
        const internals = listed as unknown as Internals
        vi.spyOn(listed, 'releaseBuffers').mockResolvedValue(undefined)
        const completeSetup = vi.spyOn(internals, '_completeSetup').mockResolvedValue(undefined)
        app.runtime.setActiveResource(listed)
        await vi.waitFor(() => expect(listed.state).toBe('error'))
        expect(listed.errorReason).toBe('Setting up worker failed')
        expect(listed.isActive).toBe(false)
        expect(completeSetup).not.toHaveBeenCalled()
        // The failed load shut down the service it created.
        expect(internals._service).toBeNull()
        expect(destroy).toHaveBeenCalledTimes(1)
        expect(listed.canRetryLoad).toBe(true)
        app.selectActiveResource(listed)
        expect(listed.state).toBe('loading')
        expect(listed.isActive).toBe(true)
        await vi.waitFor(() => expect(listed.state).toBe('ready'))
        await vi.waitFor(() => expect(completeSetup).toHaveBeenCalledTimes(1))
        expect(listed.isActive).toBe(true)
        expect(listed.errorReason).toBe('')
        expect(setupWorker).toHaveBeenCalledTimes(2)
        // The study was read once: the retry set up from the one the recording kept.
        expect(importer.importUrl).toHaveBeenCalledTimes(1)
        expect(importer.getFileTypeWorker).toHaveBeenCalledTimes(2)
        expect(internals._service).toBeInstanceOf(AccService)
        expect(destroy).toHaveBeenCalledTimes(1)
        expect(internals._setupRun).toBeNull()
    })

    it('replaces the service of a setup that failed after the load, building no channel twice', async () => {
        vi.spyOn(AccService.prototype, 'setupWorker').mockResolvedValue(60)
        const destroy = vi.spyOn(AccService.prototype, 'destroy').mockResolvedValue(undefined)
        vi.spyOn(AccService.prototype, 'setupCache').mockResolvedValue(null as never)
        const listed = list()
        const internals = listed as unknown as Internals
        vi.spyOn(listed, 'releaseBuffers').mockResolvedValue(undefined)
        app.runtime.setActiveResource(listed)
        await vi.waitFor(() => expect(listed.state).toBe('error'))
        expect(listed.errorReason).toBe('Data cache setup failed')
        expect(listed.isActive).toBe(false)
        const failed = internals._service
        const channels = listed.channels.map(channel => channel.name)
        expect(failed).toBeInstanceOf(AccService)
        expect(await listed.retryLoad()).toBe(true)
        expect(destroy).toHaveBeenCalledTimes(1)
        expect(internals._service).toBeInstanceOf(AccService)
        expect(internals._service).not.toBe(failed)
        expect(listed.channels.map(channel => channel.name)).toEqual(channels)
    })

    it('carries the hinted reason of a failed cache fill, and announces nothing beside it', async () => {
        vi.spyOn(AccService.prototype, 'setupWorker').mockResolvedValue(60)
        vi.spyOn(AccService.prototype, 'setupCache').mockResolvedValue({} as never)
        vi.mocked(Log.error).mockClear()
        const listed = list()
        vi.spyOn(listed as unknown as Internals, '_applyDefaultMontages').mockResolvedValue(undefined)
        vi.spyOn(listed, 'cacheSignals').mockResolvedValue(false as never)
        vi.spyOn(listed, 'releaseBuffers').mockResolvedValue(undefined)
        const reasonAtError: string[] = []
        listed.onPropertyChange('state', (state) => {
            if (state === 'error') {
                reasonAtError.push(listed.errorReason)
            }
        }, 'test')
        app.runtime.setActiveResource(listed)
        await vi.waitFor(() => expect(listed.state).toBe('error'))
        const reason = 'Signal caching failed; the recording may be too large for the configured memory budget'
        expect(listed.errorReason).toBe(reason)
        // The reason is in place by the time the state says so.
        expect(reasonAtError).toEqual([reason])
        expect(listed.isActive).toBe(false)
        const logged = vi.mocked(Log.error).mock.calls
        expect(logged.some(call => `${call[0]}`.includes('Signal caching failed'))).toBe(true)
        // The reason is what a host reports, so the log entry asks for no callout of its own.
        expect(logged.filter(call => (call[3] as { announce?: string } | undefined)?.announce)).toEqual([])
    })

    describe('whose cache setup is overtaken by an unload', () => {
        /** A loaded recording whose cache setup is held open at its first step. */
        const heldSetup = async () => {
            vi.spyOn(AccService.prototype, 'setupWorker').mockResolvedValue(60)
            const cache = gate<unknown>()
            const setupCache = vi.spyOn(AccService.prototype, 'setupCache')
                .mockReturnValueOnce(cache.closed as never)
                .mockResolvedValue({} as never)
            const listed = list()
            const internals = listed as unknown as Internals
            const releaseBuffers = vi.spyOn(listed, 'releaseBuffers').mockResolvedValue(undefined)
            const cacheSignals = vi.spyOn(listed, 'cacheSignals').mockResolvedValue(true)
            const montages = vi.spyOn(internals, '_applyDefaultMontages').mockResolvedValue(undefined)
            const announced = [] as string[]
            listed.addEventListener('signal-caching-complete', () => announced.push('before'), 'test', 'before')
            listed.addEventListener('signal-caching-complete', () => announced.push('after'), 'test', 'after')
            expect(await listed.load()).toBe(true)
            return { announced, cache, cacheSignals, internals, listed, montages, releaseBuffers, setupCache }
        }

        it('commissions and dispatches nothing more, and gives back what it had asked for', async () => {
            const { announced, cache, cacheSignals, internals, listed, montages, releaseBuffers } = await heldSetup()
            const setup = internals._completeSetup()
            expect(announced).toEqual(['before'])
            await listed.unload()
            expect(releaseBuffers).toHaveBeenCalledTimes(1)
            // The cache lands after the unload released the buffers.
            cache.open({})
            await setup
            expect(montages).not.toHaveBeenCalled()
            expect(cacheSignals).not.toHaveBeenCalled()
            expect(announced).toEqual(['before'])
            expect(listed.state).toBe('ready')
            expect(listed.errorReason).toBe('')
            // Released again, for the cache that landed late.
            expect(releaseBuffers).toHaveBeenCalledTimes(2)
        })

        it('does not read a step the unload made fail as a failure of the recording', async () => {
            const { cache, internals, listed } = await heldSetup()
            const setup = internals._completeSetup()
            await listed.unload()
            cache.open(null)
            await setup
            expect(listed.state).toBe('ready')
            expect(listed.errorReason).toBe('')
        })

        it('leaves the next activation a setup that runs to completion', async () => {
            const { announced, cache, cacheSignals, internals, listed, montages, setupCache } = await heldSetup()
            const setup = internals._completeSetup()
            await listed.unload()
            cache.open({})
            await setup
            app.runtime.setActiveResource(listed)
            await vi.waitFor(() => expect(announced).toEqual(['before', 'before', 'after']))
            expect(setupCache).toHaveBeenCalledTimes(2)
            expect(montages).toHaveBeenCalledTimes(1)
            expect(cacheSignals).toHaveBeenCalledTimes(1)
            expect(listed.state).toBe('ready')
        })

        it('leaves alone what a newer setup has commissioned', async () => {
            const { cache, cacheSignals, internals, listed, releaseBuffers } = await heldSetup()
            const overtaken = internals._completeSetup()
            await listed.unload()
            const newer = internals._completeSetup()
            expect(newer).not.toBe(overtaken)
            cache.open({})
            await Promise.all([overtaken, newer])
            // Only the unload released; the overtaken run found a newer one holding the cache.
            expect(releaseBuffers).toHaveBeenCalledTimes(1)
            expect(cacheSignals).toHaveBeenCalledTimes(1)
        })
    })
})
