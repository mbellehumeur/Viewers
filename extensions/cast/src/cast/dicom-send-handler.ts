import type { CastMessage } from '@kitware/vtk.js/Sources/IO/Core/CastClient';
import { LOG_PREFIX } from './constants';
import { addCastDicomToMetadataStore } from './ingest-cast-dicom';
import {
  extractFilePayloadsForEvent,
  filePayloadToArrayBuffer,
  getHubEventLower,
} from '@kitware/vtk.js/Sources/IO/Core/CastClient';
import { navigateToStudy } from './imaging-study-handler';
import { ingestNiftiFile } from './ingest-cast-nifti';

type DicomIngestCallbacks = {
  scheduleCastDicomSendLayer: (meta: {
    SeriesInstanceUID?: string;
    SOPInstanceUID?: string;
  }) => void;
};

export async function ingestDicomArrayBuffer(
  arrayBuffer: ArrayBuffer,
  callbacks: DicomIngestCallbacks
): Promise<void> {
  try {
    const ingested = addCastDicomToMetadataStore(arrayBuffer);
    if (!ingested) {
      return;
    }
    navigateToStudy(ingested.studyUID, undefined, true);
    callbacks.scheduleCastDicomSendLayer({
      SeriesInstanceUID: ingested.seriesInstanceUID,
      SOPInstanceUID: ingested.sopInstanceUID,
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} dicom-send ingest failed`, err);
  }
}

export async function handleDicomSendMessage(
  message: CastMessage,
  callbacks: DicomIngestCallbacks
): Promise<void> {
  if (getHubEventLower(message.event) !== 'dicom-send') {
    return;
  }
  const payloads = extractFilePayloadsForEvent(message, 'dicom-send');
  for (const payload of payloads) {
    const arrayBuffer = filePayloadToArrayBuffer(payload);
    if (arrayBuffer) {
      await ingestDicomArrayBuffer(arrayBuffer, callbacks);
    }
  }
}

export async function handleNiftiSendMessage(message: CastMessage): Promise<void> {
  if (getHubEventLower(message.event) !== 'nifti-send') {
    return;
  }
  const payloads = extractFilePayloadsForEvent(message, 'nifti-send');
  if (!payloads.length) {
    console.info(`${LOG_PREFIX} nifti-send: no file payloads`);
    return;
  }

  for (const [idx, payload] of payloads.entries()) {
    const arrayBuffer = filePayloadToArrayBuffer(payload);
    if (!arrayBuffer) {
      continue;
    }
    const fileName =
      'fileName' in payload && payload.fileName
        ? payload.fileName
        : `cast-nifti-send-${idx + 1}.nii.gz`;
    const file = new File([arrayBuffer], fileName, {
      type:
        'mimeType' in payload && payload.mimeType
          ? payload.mimeType
          : 'application/octet-stream',
    });
    const studyUID = await ingestNiftiFile(file, undefined, fileName);
    if (studyUID) {
      navigateToStudy(studyUID, undefined, true);
    }
  }
}
