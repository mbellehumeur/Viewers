import { Enums, metaData } from '@cornerstonejs/core';
import { createNiftiImageIdsAndCacheMetadata } from '@cornerstonejs/nifti-volume-loader';
import { DicomMetadataStore } from '@ohif/core';
import OHIF from '@ohif/core';
import { LOG_PREFIX } from './constants';
import { ensureCastNiftiLoaderRegistered } from './init-cast-nifti-loader';

const metadataProvider = OHIF.classes.MetadataProvider;

function createDicomUid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `2.25.${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `2.25.${Date.now()}${Math.floor(Math.random() * 1e9)}`;
}

async function gunzipToBlob(file: File): Promise<Blob> {
  const ds = new DecompressionStream('gzip');
  const decompressed = await new Response(file.stream().pipeThrough(ds)).arrayBuffer();
  return new Blob([decompressed], { type: 'application/octet-stream' });
}

export async function resolveNiftiLoaderUrl(
  file: File,
  remoteUrl?: string
): Promise<{ url: string; revoke?: () => void }> {
  const remoteLower = remoteUrl?.toLowerCase() || '';
  if (
    remoteUrl &&
    (remoteLower.endsWith('.nii') ||
      remoteLower.endsWith('.nii.gz') ||
      remoteLower.includes('.nii.gz?'))
  ) {
    return { url: remoteUrl };
  }

  if (file.name.toLowerCase().endsWith('.nii.gz')) {
    const blob = await gunzipToBlob(file);
    const url = URL.createObjectURL(blob);
    return { url, revoke: () => URL.revokeObjectURL(url) };
  }

  const url = URL.createObjectURL(file);
  return { url, revoke: () => URL.revokeObjectURL(url) };
}

export async function ingestNiftiFromUrl(
  niftiUrl: string,
  seriesDescription?: string
): Promise<string | null> {
  ensureCastNiftiLoaderRegistered();

  let imageIds: string[] | undefined;
  try {
    imageIds = await createNiftiImageIdsAndCacheMetadata({ url: niftiUrl });
  } catch (err) {
    console.error(`${LOG_PREFIX} NIfTI metadata load failed`, niftiUrl, err);
    return null;
  }

  if (!imageIds?.length) {
    console.warn(`${LOG_PREFIX} NIfTI load returned no imageIds`, niftiUrl);
    return null;
  }

  const studyUID = createDicomUid();
  const seriesUID = createDicomUid();
  const label = seriesDescription?.trim() || 'NIfTI Volume';

  const storeSourceUrl =
    niftiUrl.startsWith('http://') || niftiUrl.startsWith('https://');

  const instances = imageIds.map((imageId, index) => {
    const plane = metaData.get(Enums.MetadataModules.IMAGE_PLANE, imageId);
    const pixel = metaData.get(Enums.MetadataModules.IMAGE_PIXEL, imageId);
    const sopUID = createDicomUid();

    metadataProvider.addImageIdToUIDs(imageId, {
      StudyInstanceUID: studyUID,
      SeriesInstanceUID: seriesUID,
      SOPInstanceUID: sopUID,
      frameIndex: 1,
    });

    return {
      StudyInstanceUID: studyUID,
      SeriesInstanceUID: seriesUID,
      SOPInstanceUID: sopUID,
      SOPClassUID: '1.2.840.10008.5.1.4.1.1.4',
      Modality: 'MR',
      SeriesNumber: 1,
      SeriesDescription: label,
      InstanceNumber: index + 1,
      imageId,
      url: imageId,
      ...(storeSourceUrl ? { _castSourceUrl: niftiUrl } : {}),
      Rows: plane?.rows,
      Columns: plane?.columns,
      ImageOrientationPatient: plane?.imageOrientationPatient,
      ImagePositionPatient: plane?.imagePositionPatient,
      PixelSpacing: plane?.pixelSpacing,
      SliceThickness: plane?.sliceThickness,
      BitsAllocated: pixel?.bitsAllocated,
      BitsStored: pixel?.bitsStored,
      PhotometricInterpretation: pixel?.photometricInterpretation || 'MONOCHROME2',
      PatientName: 'Cast^NIfTI',
      PatientID: 'CAST-NIFTI',
    };
  });

  DicomMetadataStore.addInstances(instances, true);
  console.info(`${LOG_PREFIX} ingested NIfTI volume (${imageIds.length} slices)`, {
    studyUID,
    seriesUID,
    niftiUrl,
  });
  return studyUID;
}

export async function ingestNiftiFile(
  file: File,
  remoteUrl?: string,
  seriesDescription?: string
): Promise<string | null> {
  const { url, revoke } = await resolveNiftiLoaderUrl(file, remoteUrl);
  try {
    return await ingestNiftiFromUrl(url, seriesDescription || file.name);
  } finally {
    revoke?.();
  }
}
