/**
 * Epicurrents ACC service.
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericBiosignalService } from '@epicurrents/core'
import type { StudyContext, WorkerResponse } from '@epicurrents/core/dist/types'
import type { AccDataService, AccResource, SetupAccWorkerResponse } from '#types'

export default class AccService extends GenericBiosignalService implements AccDataService {

    get worker () {
        return this._worker
    }

    constructor (recording: AccResource, worker: Worker) {
        super(recording, worker)
        this._worker?.addEventListener('message', this.handleMessage.bind(this))
    }

    async handleMessage (message: WorkerResponse) {
        const data = message.data
        if (!data) {
            return false
        }
        return super.handleMessage(message)
    }

    async prepareWorker (study: StudyContext) {
        const { file, url } = study.files.filter(f => f.role === 'data')[0]
        const commission = this._commissionWorker(
            'setup-worker',
            new Map<string, unknown>([
                ['file', file],
                ['url', url],
            ]),
        )
        return commission.promise as Promise<SetupAccWorkerResponse>
    }
}
