import { DicomMetadataStore } from '@ohif/core';

export type StowFileEntry = {
  fileName: string;
  mimeType: string;
  data: ArrayBuffer;
  byteLength: number;
};

type OhifInstance = {
  SOPInstanceUID?: string;
  SeriesInstanceUID?: string;
  StudyInstanceUID?: string;
  url?: string;
  _castDicomArrayBuffer?: ArrayBuffer;
};

async function instanceToArrayBuffer(instance: OhifInstance): Promise<ArrayBuffer | null> {
  if (instance._castDicomArrayBuffer instanceof ArrayBuffer) {
    return instance._castDicomArrayBuffer.slice(0);
  }
  if (typeof instance.url === 'string' && instance.url.startsWith('blob:')) {
    try {
      const response = await fetch(instance.url);
      return response.arrayBuffer();
    } catch {
      return null;
    }
  }
  if (typeof instance.url === 'string' && instance.url.startsWith('http')) {
    try {
      const response = await fetch(instance.url);
      if (response.ok) {
        return response.arrayBuffer();
      }
    } catch {
      return null;
    }
  }
  return null;
}

function instanceFileName(instance: OhifInstance, index: number): string {
  const sop = instance.SOPInstanceUID?.trim();
  if (sop) {
    return `${sop}.dcm`;
  }
  return `instance-${index + 1}.dcm`;
}

export async function buildDicomStowFromStudy(
  studyInstanceUID: string,
  scope: 'study' | 'series' = 'series',
  seriesInstanceUID?: string
): Promise<StowFileEntry[]> {
  const study = DicomMetadataStore.getStudy(studyInstanceUID);
  if (!study?.series?.length) {
    throw new Error(`No series found for study ${studyInstanceUID}`);
  }

  const targetSeries =
    scope === 'series' && seriesInstanceUID
      ? study.series.filter(
          (series: { SeriesInstanceUID?: string }) =>
            series.SeriesInstanceUID === seriesInstanceUID
        )
      : study.series;

  const files: StowFileEntry[] = [];
  let index = 0;

  for (const series of targetSeries) {
    const instances = (series as { instances?: OhifInstance[] }).instances ?? [];
    for (const instance of instances) {
      const data = await instanceToArrayBuffer(instance);
      if (!data) {
        continue;
      }
      const fileName = instanceFileName(instance, index);
      index += 1;
      files.push({
        fileName,
        mimeType: 'application/dicom',
        data,
        byteLength: data.byteLength,
      });
    }
  }

  if (!files.length) {
    throw new Error('No DICOM instance bytes available to send');
  }

  return files;
}

export async function buildDicomStowFromActiveSeries(
  servicesManager: {
    services: {
      displaySetService: {
        activeDisplaySets?: Array<{
          StudyInstanceUID?: string;
          SeriesInstanceUID?: string;
        }>;
      };
      viewportGridService: {
        getActiveViewportId: () => string | undefined;
        getState: () => {
          viewports?: Map<string, { displaySetInstanceUIDs?: string[] }>;
        };
      };
    };
  }
): Promise<StowFileEntry[]> {
  const activeDisplaySets =
    servicesManager.services.displaySetService.activeDisplaySets ?? [];
  const active = activeDisplaySets[0];
  if (!active?.StudyInstanceUID || !active?.SeriesInstanceUID) {
    throw new Error('No active display set with study/series UIDs');
  }
  return buildDicomStowFromStudy(
    active.StudyInstanceUID,
    'series',
    active.SeriesInstanceUID
  );
}

export async function buildDicomStowFromActiveStudy(
  servicesManager: Parameters<typeof buildDicomStowFromActiveSeries>[0]
): Promise<StowFileEntry[]> {
  const activeDisplaySets =
    servicesManager.services.displaySetService.activeDisplaySets ?? [];
  const active = activeDisplaySets[0];
  if (!active?.StudyInstanceUID) {
    throw new Error('No active display set with study UID');
  }
  return buildDicomStowFromStudy(active.StudyInstanceUID, 'study');
}

export async function buildDicomStowFromSlice(
  studyInstanceUID: string,
  seriesInstanceUID: string,
  sopInstanceUID: string
): Promise<StowFileEntry[]> {
  const series = DicomMetadataStore.getSeries(studyInstanceUID, seriesInstanceUID);
  const instances = (series as { instances?: OhifInstance[] } | undefined)?.instances ?? [];
  const instance = instances.find(item => item.SOPInstanceUID === sopInstanceUID);
  if (!instance) {
    throw new Error(`SOP instance ${sopInstanceUID} not found`);
  }
  const data = await instanceToArrayBuffer(instance);
  if (!data) {
    throw new Error(`No bytes available for SOP instance ${sopInstanceUID}`);
  }
  return [
    {
      fileName: `${sopInstanceUID}.dcm`,
      mimeType: 'application/dicom',
      data,
      byteLength: data.byteLength,
    },
  ];
}
