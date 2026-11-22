/**
 * Tests for listing an ACC study and loading it in place, through the real application and the real loader.
 *
 * The loader and core's listing path are driven together because the contract lives between them: what the listing
 * passes to the read, what an importer declaring no modalities of its own accepts, and which object the setup runs
 * on. Only the importer is a double, and it is shaped like the CSV importer, refusing any modality it is asked to read
 * for. The worker round trip and the cache commission are stubbed, since neither is what is being pinned.
 *
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { Epicurrents } from '@epicurrents/core'
import type { MediaDataset, StudyContext } from '@epicurrents/core/types'
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

describe('a listed ACC study', () => {
    let app: Epicurrents
    let dataset: MediaDataset
    let importer: ReturnType<typeof importerDouble>

    beforeEach(() => {
        ;(window as unknown as { __EPICURRENTS__: undefined }).__EPICURRENTS__ = undefined
        app = new Epicurrents()
        app.runtime.APP.datasets.length = 0
        app.runtime.APP.activeDataset = null
        app.registerModule('acc', { runtime: {}, settings: {} } as never)
        importer = importerDouble()
        app.registerStudyImporter('acc/url', 'ACC', 'url', new AccStudyLoader('AccLoader', importer as never))
        dataset = app.createDataset('dataset', true)
        vi.spyOn(AccService.prototype, 'setupWorker').mockResolvedValue(60)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('is listed as an ACC recording that has read nothing and started no worker', () => {
        const listed = app.listStudy({ loader: 'acc/url', name: 'Listed', source: 'blob:acc' }, { dataset })
        expect(listed).toBeInstanceOf(AccRecording)
        expect(listed?.isListed).toBe(true)
        expect(importer.importUrl).not.toHaveBeenCalled()
        expect(importer.getFileTypeWorker).not.toHaveBeenCalled()
    })

    it('leaves a study opened from a file its own resource when a study is listed while it is read', async () => {
        const loader = app.runtime.APP.studyImporters.get('acc/url')!.loader as AccStudyLoader
        const useStudy = loader.useStudy.bind(loader)
        let listed = null as ReturnType<typeof app.listStudy>
        // Listed in the gap between the read handing back the next index and the loader building the resource.
        vi.spyOn(loader, 'useStudy').mockImplementation(async study => {
            const next = await useStudy(study)
            listed = app.listStudy({ loader: 'acc/url', name: 'Listed', source: 'blob:listed' }, { dataset })
            return next
        })
        const opened = await app.loadStudy('acc/url', 'blob:opened', { dataset })
        expect(listed).toBeInstanceOf(AccRecording)
        expect(opened).not.toBe(listed)
        expect(opened?.source?.files[0].url).toBe('blob:opened')
    })

    it('loads in place on activation, and commissions its cache only once it is ready', async () => {
        const states: string[] = []
        const complete = vi.spyOn(AccRecording.prototype as unknown as { _completeSetup: () => Promise<void> },
                                  '_completeSetup')
            .mockImplementation(async function (this: AccRecording) {
                states.push(this.state)
            })
        const listed = app.listStudy({ loader: 'acc/url', name: 'Listed', source: 'blob:acc' }, { dataset })!
        app.runtime.setActiveResource(listed)
        await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1))
        expect(states).toEqual(['ready'])
        expect(dataset.resources.map(ctx => ctx.resource)).toEqual([listed])
        // The three axes, then the magnitude the default setup derives from them.
        expect((listed as AccRecording).channels.length).toBeGreaterThanOrEqual(3)
        expect(importer.getFileTypeWorker).toHaveBeenCalledTimes(1)
        expect(importer.getFileTypeWorker).toHaveBeenCalledWith('acc')
    })

    it('commissions the cache of a loaded recording within the activation itself', async () => {
        const complete = vi.spyOn(AccRecording.prototype as unknown as { _completeSetup: () => Promise<void> },
                                  '_completeSetup')
            .mockResolvedValue(undefined)
        const listed = app.listStudy({ loader: 'acc/url', name: 'Listed', source: 'blob:acc' }, { dataset })!
        expect(await listed.load()).toBe(true)
        // No await: the plot requests signals as soon as the recording is active, and the setup has to reach the
        // worker before that request does.
        app.runtime.setActiveResource(listed)
        expect(complete).toHaveBeenCalledTimes(1)
    })

    it('completes the setup of a listed recording activated while its study is being read', async () => {
        const complete = vi.spyOn(AccRecording.prototype as unknown as { _completeSetup: () => Promise<void> },
                                  '_completeSetup')
            .mockResolvedValue(undefined)
        const listed = app.listStudy({ loader: 'acc/url', name: 'Listed', source: 'blob:acc' }, { dataset })!
        // Somebody else's load: the recording is neither listed nor holding a source while it reads.
        const loaded = listed.load()
        expect(listed.state).toBe('loading')
        expect(listed.source).toBe(null)
        listed.isActive = true
        expect(await loaded).toBe(true)
        await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1))
    })

    it('runs one setup for calls made while it is in flight, and another once it has settled', async () => {
        type Internals = { _completeSetup: () => Promise<void>, _runSetup: () => Promise<void> }
        const listed = app.listStudy({ loader: 'acc/url', name: 'Listed', source: 'blob:acc' }, { dataset })!
        const internals = listed as unknown as Internals
        let finish = () => {}
        const run = vi.spyOn(internals, '_runSetup').mockImplementation(() => new Promise<void>(resolve => {
            finish = resolve
        }))
        const first = internals._completeSetup()
        expect(internals._completeSetup()).toBe(first)
        expect(run).toHaveBeenCalledTimes(1)
        finish()
        await first
        expect(internals._completeSetup()).not.toBe(first)
        expect(run).toHaveBeenCalledTimes(2)
    })

    it('shuts down the service it created when the worker cannot be set up', async () => {
        vi.spyOn(AccService.prototype, 'setupWorker').mockResolvedValue(0)
        const destroy = vi.spyOn(AccService.prototype, 'destroy').mockResolvedValue(undefined)
        const listed = app.listStudy({ loader: 'acc/url', name: 'Listed', source: 'blob:acc' }, { dataset })!
        expect(await listed.load()).toBe(false)
        expect(listed.errorReason).toBe('Setting up worker failed')
        expect(destroy).toHaveBeenCalledTimes(1)
        expect((listed as unknown as { _service: unknown })._service).toBe(null)
    })

    it('is left listed, with the service of the load shut down, when it is unloaded while it loads', async () => {
        let answer = (_duration: number) => {}
        const setupWorker = vi.spyOn(AccService.prototype, 'setupWorker').mockReturnValue(new Promise(resolve => {
            answer = resolve
        }))
        const destroy = vi.spyOn(AccService.prototype, 'destroy').mockResolvedValue(undefined)
        const listed = app.listStudy({ loader: 'acc/url', name: 'Listed', source: 'blob:acc' }, { dataset })!
        // The buffer release is core's own and not what is being pinned.
        vi.spyOn(listed as AccRecording, 'releaseBuffers').mockResolvedValue(undefined)
        const loaded = listed.load()
        await vi.waitFor(() => expect(setupWorker).toHaveBeenCalledTimes(1))
        await listed.unload()
        expect(listed.state).toBe('added')
        answer(60)
        expect(await loaded).toBe(false)
        expect(listed.state).toBe('added')
        expect(listed.errorReason).toBe('')
        expect(destroy).toHaveBeenCalledTimes(1)
        expect((listed as unknown as { _service: unknown })._service).toBe(null)
    })

    it('starts a setup of its own once an unload has interrupted the one in flight', async () => {
        type Internals = { _completeSetup: () => Promise<void>, _runSetup: () => Promise<void> }
        const listed = app.listStudy({ loader: 'acc/url', name: 'Listed', source: 'blob:acc' }, { dataset })!
        vi.spyOn(listed as AccRecording, 'releaseBuffers').mockResolvedValue(undefined)
        const internals = listed as unknown as Internals
        const run = vi.spyOn(internals, '_runSetup').mockImplementation(() => new Promise<void>(() => {}))
        const first = internals._completeSetup()
        await listed.unload()
        expect(internals._completeSetup()).not.toBe(first)
        expect(run).toHaveBeenCalledTimes(2)
    })

    it('lets go of the worker source when it is destroyed', async () => {
        const listed = app.listStudy({ loader: 'acc/url', name: 'Listed', source: 'blob:acc' }, { dataset })!
        // The buffer release is core's own and not what is being pinned.
        vi.spyOn(listed as AccRecording, 'releaseBuffers').mockResolvedValue(undefined)
        await listed.destroy()
        expect((listed as unknown as { _getWorker: unknown })._getWorker).toBe(null)
    })

    it('creates the listed recording under the modality it is listed as', () => {
        const loader = new AccStudyLoader('AccLoader', importer as never)
        const base = { loader: 'acc/url', name: 'Listed', source: 'blob:acc' }
        expect(loader.createListedResource({ ...base, modality: 'acc-wrist' }).modality).toBe('acc-wrist')
        expect(loader.createListedResource(base).modality).toBe('acc')
    })

    it('fails on the listed object when the study it reads is incomplete', async () => {
        importer.importUrl.mockImplementationOnce(async () => {
            importer.study!.meta = { channels: CHANNELS }
            return true
        })
        const listed = app.listStudy({ loader: 'acc/url', name: 'Listed', source: 'blob:acc' }, { dataset })!
        expect(await listed.load()).toBe(false)
        expect(listed.state).toBe('error')
        expect(listed.errorReason).toBe('Recording study is incomplete')
        expect(dataset.resources.map(ctx => ctx.resource)).toEqual([listed])
        expect(importer.getFileTypeWorker).not.toHaveBeenCalled()
    })
})
