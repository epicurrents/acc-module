/**
 * Epicurrents ACC study loader.
 *
 * Pulls the parsed channel descriptors and {@link BiosignalHeaderRecord} the
 * CSV importer wrote into `study.meta` and hands them to `AccRecording` along
 * with the file worker and the registered memory manager. The resource's own
 * `prepare()` then runs the worker round-trip and applies the default ACC
 * setup before activation.
 *
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { BiosignalStudyLoader, GenericBiosignalHeader } from '@epicurrents/core'
import type {
    BiosignalChannel,
    ConfigStudyLoader,
    FileFormatImporter,
    FileSystemItem,
    SafeObject,
    StudyContext,
} from '@epicurrents/core/types'
import AccRecording from '../AccRecording'
import type { AccResource } from '#types'
import { Log } from 'scoped-event-log'

const SCOPE = 'AccStudyLoader'

export default class AccStudyLoader extends BiosignalStudyLoader {

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
        const meta = this._study.meta as {
            channels?: BiosignalChannel[]
            formatHeader?: SafeObject
            header?: GenericBiosignalHeader
        }
        if (!this._study.name || !meta?.channels || !meta.header) {
            Log.error(
                `Cannot construct an ACC resource from given study context; ` +
                `it is missing required properties (channels / header).`,
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
            meta.channels,
            meta.header,
            worker,
            this._memoryManager || undefined,
            { formatHeader: meta.formatHeader },
        )
        acc.source = this._study
        acc.state = 'loaded'
        this._resources.push(acc)
        this._study = null
        return acc
    }

    /**
     * Narrow a loaded study to the ACC modality. The format importers are modality-agnostic and
     * stamp their data files as a generic `signal`, so every loading path has to narrow both the
     * study and its data files — anything looking a data file up by modality finds nothing
     * otherwise, and an unstamped study falls back to the `unknown` of the context template.
     */
    protected _claimAsAcc (study: StudyContext | null): StudyContext | null {
        if (!study) {
            return null
        }
        study.modality = 'acc'
        for (const file of study.files) {
            if (file.modality === 'signal') {
                file.modality = 'acc'
            }
        }
        return study
    }

    async loadFromDirectory (dir: FileSystemItem, config?: ConfigStudyLoader): Promise<StudyContext | null> {
        return this._claimAsAcc(await super.loadFromDirectory(dir, config))
    }

    async loadFromFile (
        file: File,
        config?: ConfigStudyLoader,
        preStudy?: StudyContext,
    ): Promise<StudyContext | null> {
        return this._claimAsAcc(await super.loadFromFile(file, config, preStudy))
    }

    async loadFromUrl (
        fileUrl: string,
        config?: ConfigStudyLoader,
        preStudy?: StudyContext,
    ): Promise<StudyContext | null> {
        return this._claimAsAcc(await super.loadFromUrl(fileUrl, config, preStudy))
    }
}
