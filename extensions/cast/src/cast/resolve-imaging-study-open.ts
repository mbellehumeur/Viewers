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
  extractOhifMode,
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
  ohifMode?: string;
};

export type ImagingStudyFilesOpen = {
  mode: 'files';
  studyId: string;
  files: CastImagingStudyFileEntry[];
  ohifMode?: string;
};

export type ImagingStudyDicomUrlOpen = {
  mode: 'dicom-url';
  studyId: string;
  files: CastImagingStudyFileEntry[];
  ohifMode?: string;
};

export type ImagingStudyIdcOpen = {
  mode: 'idc';
  studyId: string;
  studyInstanceUID: string;
  seriesInstanceUID?: string;
  sourceBucket: 'aws' | 'gcs';
  files: CastImagingStudyFileEntry[];
  ohifMode?: string;
};

export type ImagingStudyOpenPlan =
  | ImagingStudyDicomwebOpen
  | ImagingStudyDicomUrlOpen
  | ImagingStudyFilesOpen
  | ImagingStudyIdcOpen;

function resolveFilesPlan(
  context: unknown,
  studyId: string,
  ohifMode?: string
): ImagingStudyFilesOpen | null {
  const normalized = normalizeImagingStudyContext(context);
  const files = extractImagingStudyFiles(normalized);
  if (files.length === 0) {
    return null;
  }
  return { mode: 'files', studyId, files, ohifMode };
}

export function resolveImagingStudyOpenPlan(
  context: unknown
): ImagingStudyOpenPlan | null {
  const normalized = normalizeImagingStudyContext(context);
  const studyId = extractVolviewSampleId(normalized) || 'study';
  const openMode = extractOpenMode(normalized);
  const ohifMode = extractOhifMode(normalized) || undefined;

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
      ohifMode,
    };
  }

  if (openMode === CAST_OPEN_MODE_FILES) {
    const filesPlan = resolveFilesPlan(normalized, studyId, ohifMode);
    if (filesPlan) {
      return filesPlan;
    }
  }

  if (openMode === CAST_OPEN_MODE_DICOM_URL) {
    const files = extractImagingStudyFiles(normalized);
    if (!files.length) {
      return null;
    }
    return { mode: 'dicom-url', studyId, files, ohifMode };
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
      ohifMode,
    };
  }

  const legacyFiles = resolveFilesPlan(normalized, studyId, ohifMode);
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
      ohifMode,
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
      ohifMode,
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
