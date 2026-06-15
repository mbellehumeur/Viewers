import type { CastMessage } from '@kitware/vtk.js/Sources/IO/Core/CastClient';
import {
  deleteUsPleuraBLineAnnotations,
  importUsPleuraBLineAnnotations,
} from './import-us-annotations';
import { navigateToCastEmptyViewer, navigateToCastViewer } from './cast-navigate';
import {
  collectImagingStudyDownloadEntries,
  hasNiftiDownloadHint,
  toCastFileEntries,
} from './collect-imaging-study-downloads';
import { LOG_PREFIX } from './constants';
import {
  getHubEventLower,
  normalizeImagingStudyContext,
  resolveImagingStudyOpenPlan,
} from '@kitware/vtk.js/Sources/IO/Core/CastClient';
import {
  extractInlineOpenFilePayloads,
  loadCastIdcStudyFiles,
  loadCastStudyFilesFromPayloads,
  loadCastStudyFilesFromUrls,
} from './load-cast-study-files';
import type { CastEvent } from './types';

type DicomIngestCallbacks = {
  scheduleCastDicomSendLayer: (meta: {
    SeriesInstanceUID?: string;
    SOPInstanceUID?: string;
  }) => void;
};

function looksLikeDicomUid(value: string): boolean {
  return /^\d+(?:\.\d+)+$/.test(value.trim());
}

export function navigateToStudy(
  studyUID: string,
  seriesUID?: string,
  useLocalDataSource = false,
  ohifMode?: string
): void {
  const currentLocation =
    typeof window !== 'undefined' ? window.location.toString() : '';
  if (currentLocation.includes(studyUID)) {
    return;
  }
  navigateToCastViewer([studyUID], { seriesUID, useLocalDataSource, modeRoute: ohifMode });
}

export class ImagingStudyHandler {
  constructor(private dicomCallbacks: DicomIngestCallbacks) {}

  async handleOpen(
    event: CastEvent | undefined,
    _message?: CastMessage
  ): Promise<void> {
    if (!event?.context) {
      console.info(`${LOG_PREFIX} imagingstudy-open ignored: empty context`);
      return;
    }

    const normalizedContext = normalizeImagingStudyContext(event.context);
    const downloadEntries = collectImagingStudyDownloadEntries(normalizedContext);
    const plan = resolveImagingStudyOpenPlan(normalizedContext);

    console.info(`${LOG_PREFIX} imagingstudy-open`, {
      context: normalizedContext,
      plan,
      downloadEntries,
      niftiHint: hasNiftiDownloadHint(downloadEntries),
    });

    const inlinePayloads = extractInlineOpenFilePayloads(event);
    if (inlinePayloads.length) {
      await loadCastStudyFilesFromPayloads(inlinePayloads, this.dicomCallbacks);
      return;
    }

    if (plan?.mode === 'idc' && plan.files.length > 0) {
      await loadCastIdcStudyFiles(plan, this.dicomCallbacks);
      return;
    }

    if (plan?.mode === 'dicom-url' && plan.files.length > 0) {
      await loadCastStudyFilesFromUrls(plan.files, this.dicomCallbacks, {
        ohifMode: plan.ohifMode,
      });
      return;
    }

    if (downloadEntries.length > 0) {
      console.info(
        `${LOG_PREFIX} imagingstudy-open downloading ${downloadEntries.length} remote file(s)`,
        downloadEntries.map(entry => ({
          url: entry.url,
          fileName: entry.fileName,
          source: entry.source,
        }))
      );
      await loadCastStudyFilesFromUrls(
        toCastFileEntries(downloadEntries),
        this.dicomCallbacks,
        { ohifMode: plan?.ohifMode }
      );
      return;
    }

    if (!plan) {
      const contextItems = Array.isArray(normalizedContext)
        ? (normalizedContext as Array<{ key?: string; resource?: unknown }>)
        : [];
      const studyResource = contextItems.find(item => item.key === 'study')?.resource;
      const studyUID =
        studyResource && typeof studyResource === 'object'
          ? (studyResource as { uid?: string }).uid
          : undefined;
      if (typeof studyUID === 'string' && studyUID.trim() && looksLikeDicomUid(studyUID)) {
        navigateToStudy(studyUID.trim(), undefined, false);
      } else {
        console.warn(
          `${LOG_PREFIX} imagingstudy-open: no downloadable files or DICOMweb plan in context`
        );
      }
      return;
    }

    if (plan.mode === 'dicomweb') {
      navigateToStudy(
        plan.studyInstanceUID,
        plan.seriesInstanceUID,
        false,
        plan.ohifMode
      );
      return;
    }

    if (plan.mode === 'files' && plan.files.length > 0) {
      await loadCastStudyFilesFromUrls(plan.files, this.dicomCallbacks, {
        ohifMode: plan.ohifMode,
      });
      return;
    }

    console.warn(
      `${LOG_PREFIX} imagingstudy-open: files mode resolved but no URLs were found`
    );
  }

  handleClose(): void {
    navigateToCastEmptyViewer({ replace: true });
  }
}

export function handleAnnotationEvent(
  message: CastMessage,
  servicesManager: import('./types').ServicesManagerLike
): void {
  const hubEvent = getHubEventLower(message.event);
  if (hubEvent !== 'annotation-update' && hubEvent !== 'annotation-delete') {
    return;
  }
  const context = message.event?.context;
  if (hubEvent === 'annotation-delete') {
    deleteUsPleuraBLineAnnotations(servicesManager);
    return;
  }
  importUsPleuraBLineAnnotations(servicesManager, context);
}
