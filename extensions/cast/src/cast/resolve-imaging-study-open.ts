import {
  CAST_OPEN_MODE_DICOMWEB,
  CAST_OPEN_MODE_DICOM_URL,
  CAST_OPEN_MODE_FILES,
  CAST_OPEN_MODE_IDC,
  extractDicomSeriesUid,
  extractDicomStudyUid,
  extractDicomwebRoot,
  extractIdcSeriesUid,
  extractIdcSourceBucket,
  extractImagingStudyFiles,
  extractNiftiDownloadUrl,
  extractNiftiFilename,
  extractOpenMode,
  extractVolviewSampleId,
  type CastImagingStudyFileEntry,
} from '@kitware/vtk.js/Sources/IO/Core/CastClient';
import { normalizeImagingStudyContext } from './normalize-imaging-study-context';

export type ImagingStudyDicomwebOpen = {
  mode: 'dicomweb';
  studyId: string;
  studyInstanceUID: string;
  seriesInstanceUID?: string;
  dicomwebRoot?: string;
};

export type ImagingStudyFilesOpen = {
  mode: 'files';
  studyId: string;
  files: CastImagingStudyFileEntry[];
};

export type ImagingStudyDicomUrlOpen = {
  mode: 'dicom-url';
  studyId: string;
  files: CastImagingStudyFileEntry[];
};

export type ImagingStudyIdcOpen = {
  mode: 'idc';
  studyId: string;
  studyInstanceUID: string;
  seriesInstanceUID?: string;
  sourceBucket: 'aws' | 'gcs';
  files: CastImagingStudyFileEntry[];
};

export type ImagingStudyOpenPlan =
  | ImagingStudyDicomwebOpen
  | ImagingStudyDicomUrlOpen
  | ImagingStudyFilesOpen
  | ImagingStudyIdcOpen;

function resolveFilesPlan(
  context: unknown,
  studyId: string
): ImagingStudyFilesOpen | null {
  const normalized = normalizeImagingStudyContext(context);
  const files = extractImagingStudyFiles(normalized);
  if (files.length === 0) {
    return null;
  }
  return { mode: 'files', studyId, files };
}

export function resolveImagingStudyOpenPlan(
  context: unknown
): ImagingStudyOpenPlan | null {
  const normalized = normalizeImagingStudyContext(context);
  const studyId = extractVolviewSampleId(normalized) || 'study';
  const openMode = extractOpenMode(normalized);

  if (openMode === CAST_OPEN_MODE_DICOMWEB) {
    const studyInstanceUID = extractDicomStudyUid(normalized);
    if (!studyInstanceUID) {
      return null;
    }
    const seriesInstanceUID = extractDicomSeriesUid(normalized) || undefined;
    const dicomwebRoot = extractDicomwebRoot(normalized) || undefined;
    return {
      mode: 'dicomweb',
      studyId,
      studyInstanceUID,
      seriesInstanceUID,
      dicomwebRoot,
    };
  }

  if (openMode === CAST_OPEN_MODE_FILES) {
    const filesPlan = resolveFilesPlan(normalized, studyId);
    if (filesPlan) {
      return filesPlan;
    }
  }

  if (openMode === CAST_OPEN_MODE_DICOM_URL) {
    const files = extractImagingStudyFiles(normalized);
    if (!files.length) {
      return null;
    }
    return { mode: 'dicom-url', studyId, files };
  }

  if (openMode === CAST_OPEN_MODE_IDC) {
    const studyInstanceUID = extractDicomStudyUid(normalized);
    if (!studyInstanceUID) {
      return null;
    }
    const files = extractImagingStudyFiles(normalized);
    if (!files.length) {
      return null;
    }
    const seriesInstanceUID =
      extractIdcSeriesUid(normalized) ||
      extractDicomSeriesUid(normalized) ||
      undefined;
    return {
      mode: 'idc',
      studyId,
      studyInstanceUID,
      seriesInstanceUID,
      sourceBucket: extractIdcSourceBucket(normalized),
      files,
    };
  }

  const legacyFiles = resolveFilesPlan(normalized, studyId);
  if (legacyFiles) {
    return legacyFiles;
  }

  const url = extractNiftiDownloadUrl(normalized);
  if (url) {
    const filename = extractNiftiFilename(normalized);
    return {
      mode: 'files',
      studyId,
      files: [{ url, fileName: filename || 'volume.nii.gz', label: studyId }],
    };
  }

  const studyInstanceUID = extractDicomStudyUid(normalized);
  if (studyInstanceUID) {
    return {
      mode: 'dicomweb',
      studyId,
      studyInstanceUID,
      seriesInstanceUID: extractDicomSeriesUid(normalized) || undefined,
      dicomwebRoot: extractDicomwebRoot(normalized) || undefined,
    };
  }

  return null;
}

export function normalizeStudyUID(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/^urn:oid:/i, '');
}

export function extractStudyUIDFromResource(resource: unknown): string {
  if (!resource || typeof resource !== 'object') {
    return '';
  }

  const typedResource = resource as {
    uid?: unknown;
    identifier?: Array<{ system?: unknown; value?: unknown }>;
  };

  const fromUid = normalizeStudyUID(typedResource.uid);
  if (fromUid) {
    return fromUid;
  }

  const identifiers = Array.isArray(typedResource.identifier)
    ? typedResource.identifier
    : [];
  const dicomUidIdentifier = identifiers.find(
    identifier =>
      typeof identifier?.system === 'string' &&
      identifier.system.toLowerCase() === 'urn:dicom:uid'
  );
  return normalizeStudyUID(dicomUidIdentifier?.value);
}
