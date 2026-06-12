/**
 * Epicurrents ACC study loader.
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { GenericStudyLoader } from '@epicurrents/core'
import type {
    ConfigStudyLoader,
    FileFormatImporter,
    FileSystemItem,
    StudyContext,
} from '@epicurrents/core/dist/types'
import { AccRecording } from '..'
import type { AccResource, AccStudyContext } from '#types'
import { Log } from 'scoped-event-log'

const SCOPE = 'AccStudyLoader'

export default class AccStudyLoader extends GenericStudyLoader {

    protected _study: AccStudyContext | null = null

    constructor (name: string, importer: FileFormatImporter) {
        super(name, ['acc'], importer)
    }

    get resourceModality () {
        return 'acc'
    }

    async getResource (idx: number | string = -1): Promise<AccResource | null> {
        const loaded = await super.getResource(idx)
        if (loaded) {
            return loaded as AccResource
        } else if (!this._study) {
            return null
        }
        if (!this._study.name) {
            Log.error(
                `Cannot construct an ACC resource from given study context; it is missing required properties.`,
                SCOPE,
            )
            return null
        }
        const worker = this._studyImporter?.getFileTypeWorker('acc')
        if (!worker) {
            Log.error(`Study loader does not have a file worker.`, SCOPE)
            return null
        }
        const acc = new AccRecording(
            this._study.name,
            this._study,
            worker,
        )
        acc.state = 'loaded'
        acc.source = this._study
        this._resources.push(acc)
        this._study = null
        return acc
    }

    public async loadFromDirectory (dir: FileSystemItem, config?: ConfigStudyLoader): Promise<StudyContext | null> {
        const context = await super.loadFromDirectory(dir, config)
        if (!context) {
            return null
        }
        context.modality = 'acc'
        return context
    }

    public async loadFromUrl (
        fileUrl: string,
        config?: ConfigStudyLoader,
        preStudy?: StudyContext | undefined,
    ): Promise<StudyContext | null> {
        const context = await super.loadFromUrl(fileUrl, config, preStudy)
        if (!context) {
            return null
        }
        context.modality = 'acc'
        return context
    }
}
