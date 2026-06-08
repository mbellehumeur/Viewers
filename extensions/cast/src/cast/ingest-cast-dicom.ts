import dcmjs from 'dcmjs';
import { DicomMetadataStore } from '@ohif/core';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';

function castDicomFileName(
  sopInstanceUID: string | undefined,
  fileName: string | undefined,
  index: number
): string {
  const sop = sopInstanceUID?.trim();
  if (sop) {
    return `${sop}.dcm`;
  }
  if (fileName?.trim()) {
    return fileName.trim();
  }
  return `cast-${index + 1}.dcm`;
}

/**
 * Ingest one DICOM instance for local/IDC viewing. Uses wadouri fileManager IDs
 * so Cornerstone can load images (raw blob: URLs are not supported).
 */
export type CastDicomIngestResult = {
  studyUID: string;
  seriesInstanceUID?: string;
  sopInstanceUID?: string;
};

export function addCastDicomToMetadataStore(
  arrayBuffer: ArrayBuffer,
  options?: { fileName?: string; index?: number; sourceUrl?: string }
): CastDicomIngestResult | null {
  try {
    const dicomData = dcmjs.data.DicomMessage.readFile(arrayBuffer);
    const dicomJSONDataset = dicomData.dict;
    const naturalizedDataset =
      dicomJSONDataset.SeriesInstanceUID === undefined
        ? dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomJSONDataset)
        : dicomJSONDataset;
    const studyUID = naturalizedDataset.StudyInstanceUID;
    if (!studyUID) {
      return null;
    }

    const name = castDicomFileName(
      naturalizedDataset.SOPInstanceUID as string | undefined,
      options?.fileName,
      options?.index ?? 0
    );
    const file = new File([arrayBuffer], name, { type: 'application/dicom' });
    const imageId = dicomImageLoader.wadouri.fileManager.add(file);

    naturalizedDataset._castDicomArrayBuffer = arrayBuffer.slice(0);
    naturalizedDataset.url = imageId;
    const sourceUrl = options?.sourceUrl?.trim();
    if (sourceUrl && (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://'))) {
      naturalizedDataset._castSourceUrl = sourceUrl;
    }
    DicomMetadataStore.addInstances([naturalizedDataset], true);
    return {
      studyUID,
      seriesInstanceUID: naturalizedDataset.SeriesInstanceUID as string | undefined,
      sopInstanceUID: naturalizedDataset.SOPInstanceUID as string | undefined,
    };
  } catch {
    return null;
  }
}
