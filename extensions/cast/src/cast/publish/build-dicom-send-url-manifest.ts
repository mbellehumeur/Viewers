import { DicomMetadataStore } from '@ohif/core';

export type UrlSendFileEntry = {
  fileName: string;
  url: string;
  mimeType: string;
  byteLength?: number;
};

export type TotalSegmentatorSendManifest = {
  hubEvent: 'dicom-send' | 'nifti-send';
  files: UrlSendFileEntry[];
};

type OhifInstance = {
  StudyInstanceUID?: string;
  SeriesInstanceUID?: string;
  SOPInstanceUID?: string;
  url?: string;
  wadoRoot?: string;
  _castSourceUrl?: string;
  _castDicomArrayBuffer?: ArrayBuffer;
};

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function isNiftiSourceUrl(url: string): boolean {
  const lower = url.toLowerCase().split('?')[0];
  return lower.endsWith('.nii') || lower.endsWith('.nii.gz');
}

function instanceFileName(instance: OhifInstance, index: number): string {
  const sop = instance.SOPInstanceUID?.trim();
  if (sop) {
    return `${sop}.dcm`;
  }
  return `instance-${index + 1}.dcm`;
}

function resolveInstanceUrl(instance: OhifInstance): string | null {
  const sourceUrl = instance._castSourceUrl?.trim();
  if (sourceUrl && isHttpUrl(sourceUrl)) {
    return sourceUrl;
  }

  const wadoRoot = instance.wadoRoot?.trim();
  const studyUID = instance.StudyInstanceUID?.trim();
  const seriesUID = instance.SeriesInstanceUID?.trim();
  const sopUID = instance.SOPInstanceUID?.trim();
  if (wadoRoot && studyUID && seriesUID && sopUID && isHttpUrl(wadoRoot)) {
    return `${wadoRoot.replace(/\/$/, '')}/studies/${studyUID}/series/${seriesUID}/instances/${sopUID}`;
  }

  const directUrl = instance.url?.trim();
  if (directUrl && isHttpUrl(directUrl)) {
    return directUrl;
  }

  return null;
}

function niftiFileNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const base = pathname.split('/').pop();
    if (base?.trim()) {
      return base.trim();
    }
  } catch {
    // fall through
  }
  return 'nifti-send.nii.gz';
}

function buildNiftiSendManifest(instances: OhifInstance[]): TotalSegmentatorSendManifest {
  for (const instance of instances) {
    const sourceUrl = instance._castSourceUrl?.trim();
    if (sourceUrl && isHttpUrl(sourceUrl) && isNiftiSourceUrl(sourceUrl)) {
      return {
        hubEvent: 'nifti-send',
        files: [
          {
            fileName: niftiFileNameFromUrl(sourceUrl),
            url: sourceUrl,
            mimeType: 'application/octet-stream',
          },
        ],
      };
    }
  }

  throw new Error(
    'Active series is a NIfTI volume without a downloadable HTTP(S) source URL'
  );
}

export function buildTotalSegmentatorSendManifest(
  studyInstanceUID: string,
  seriesInstanceUID: string
): TotalSegmentatorSendManifest {
  const series = DicomMetadataStore.getSeries(studyInstanceUID, seriesInstanceUID);
  const instances = ((series as { instances?: OhifInstance[] } | undefined)?.instances ??
    []) as OhifInstance[];

  if (!instances.length) {
    throw new Error(`No instances found for series ${seriesInstanceUID}`);
  }

  const niftiCandidate = instances.some(instance => {
    const sourceUrl = instance._castSourceUrl?.trim();
    return sourceUrl && isHttpUrl(sourceUrl) && isNiftiSourceUrl(sourceUrl);
  });
  if (niftiCandidate) {
    return buildNiftiSendManifest(instances);
  }

  const files: UrlSendFileEntry[] = [];
  const missing: string[] = [];

  instances.forEach((instance, index) => {
    const url = resolveInstanceUrl(instance);
    if (!url) {
      const sop = instance.SOPInstanceUID?.trim() || `index ${index}`;
      missing.push(sop);
      return;
    }
    const entry: UrlSendFileEntry = {
      fileName: instanceFileName(instance, index),
      url,
      mimeType: 'application/dicom',
    };
    if (instance._castDicomArrayBuffer instanceof ArrayBuffer) {
      entry.byteLength = instance._castDicomArrayBuffer.byteLength;
    }
    files.push(entry);
  });

  if (!files.length) {
    throw new Error(
      'No downloadable HTTP(S) URLs for the active series (local blob/wadouri data cannot be sent without binary attach)'
    );
  }

  if (missing.length) {
    throw new Error(
      `Missing downloadable URLs for ${missing.length} instance(s); cannot send series without binary attach`
    );
  }

  return {
    hubEvent: 'dicom-send',
    files,
  };
}

export function buildTotalSegmentatorSendManifestFromActiveSeries(servicesManager: {
  services: {
    displaySetService: {
      activeDisplaySets?: Array<{
        StudyInstanceUID?: string;
        SeriesInstanceUID?: string;
      }>;
    };
  };
}): TotalSegmentatorSendManifest {
  const active = servicesManager.services.displaySetService.activeDisplaySets?.[0];
  const studyInstanceUID = active?.StudyInstanceUID?.trim();
  const seriesInstanceUID = active?.SeriesInstanceUID?.trim();
  if (!studyInstanceUID || !seriesInstanceUID) {
    throw new Error('No active display set with study and series UIDs');
  }
  return buildTotalSegmentatorSendManifest(studyInstanceUID, seriesInstanceUID);
}
