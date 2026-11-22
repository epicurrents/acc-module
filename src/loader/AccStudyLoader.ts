/**
 * Epicurrents ACC study loader.
 *
 * Builds an `AccRecording`, unloaded, from a study whose `meta` carries the
 * channel descriptors and {@link BiosignalHeaderRecord} the CSV importer wrote,
 * or from a listing that reads such a study later. The recording's own load
 * asks for the file worker, runs the worker round trip and applies the
 * default ACC setup before activation.
 *
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */

import { BiosignalStudyLoader } from '@epicurrents/core'
import type {
    ConfigStudyLoader,
    FileFormatImporter,
    FileSystemItem,
    StudyContext,
    StudyListing,
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

    /**
     * The importer's ACC worker. A recording asks for it when it loads, not when it is created.
     */
    protected _getFileWorker () {
        return this._studyImporter?.getFileTypeWorker('acc') ?? null
    }

    createListedResource (listing: StudyListing) {
        // Kept out of `_resources`: that list is what a read study's resource is found in by index, and a listing
        // entered between a read and its `getResource` would take the read study's place. The recording takes the
        // modality it is listed under, which the loader has been checked to support.
        return new AccRecording(
            listing.name,
            undefined,
            () => this._getFileWorker(),
            this._memoryManager || undefined,
            listing.modality ? { modality: listing.modality } : undefined,
        )
    }

    async getResource (idx: number | string = -1): Promise<AccResource | null> {
        const loaded = await super.getResource(idx)
        if (loaded) {
            return loaded as AccResource
        } else if (!this._study) {
            return null
        }
        if (!AccRecording.isCompleteStudy(this._study)) {
            Log.error(
                `Cannot construct an ACC resource from given study context; ` +
                `it is missing required properties (channels / header).`,
                SCOPE,
            )
            return null
        }
        // Built unloaded, as a listed recording is: the loader that opened the study loads it straight after.
        const acc = new AccRecording(
            this._study.name,
            this._study,
            () => this._getFileWorker(),
            this._memoryManager || undefined,
        )
        acc.state = 'loaded'
        this._resources.push(acc)
        this._study = null
        return acc
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
