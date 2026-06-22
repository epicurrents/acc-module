/**
 * Epicurrents ACC service. Bridges the main-thread {@link AccRecording} with
 * the CSV reader worker. Mirrors the EEG service pattern: `setupWorker` posts
 * the parsed `BiosignalHeaderRecord` plus the source URL to the worker, awaits
 * the recording-length response, and returns it so the resource can set its
 * `totalDuration` and proceed with `_applyDefaultSetups()`.
 *
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericBiosignalService } from '@epicurrents/core'
import type {
    BiosignalDataService,
    BiosignalHeaderRecord,
    BiosignalResource,
    MemoryManager,
    SetupStudyResponse,
    StudyContext,
    UrlAccessOptions,
    WorkerResponse,
} from '@epicurrents/core/dist/types'
import { Log } from 'scoped-event-log'

const SCOPE = 'AccService'

export default class AccService extends GenericBiosignalService implements BiosignalDataService {

    constructor (recording: BiosignalResource, worker: Worker, manager?: MemoryManager) {
        super(recording, worker, manager)
        this._worker?.addEventListener('message', this.handleMessage.bind(this))
    }

    get worker () {
        return this._worker
    }

    async handleMessage (message: WorkerResponse) {
        const data = message.data
        if (!data) {
            return false
        }
        return super.handleMessage(message)
    }

    async setupWorker (
        header: BiosignalHeaderRecord,
        study: StudyContext,
        options?: UrlAccessOptions,
        formatHeader?: unknown,
    ) {
        const fileUrl = study.files.filter(f => f.role === 'data').map(file => file.url)[0]
        if (!fileUrl) {
            Log.error(`Cannot set up worker: study has no data file URL.`, SCOPE)
            return null as unknown as SetupStudyResponse
        }
        Log.info(`Loading ACC study ${study.name} in worker.`, SCOPE)
        this._initWaiters('setup-worker')
        const commission = this._commissionWorker(
            'setup-worker',
            new Map<string, unknown>([
                ['header', header.serializable],
                ['url', fileUrl],
                ['authHeader', options?.authHeader || null],
                ['formatHeader', formatHeader || null],
            ]),
        )
        return commission.promise as Promise<SetupStudyResponse>
    }
}
