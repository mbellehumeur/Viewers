import {
  CAST_IDENTIFIER_NIFTI_FILENAME,
  CAST_IDENTIFIER_NIFTI_URL,
  extractImagingStudyFiles,
  extractNiftiDownloadUrl,
  extractNiftiFilename,
  normalizeImagingStudyContext,
  type CastImagingStudyFileEntry,
} from '@kitware/vtk.js/Sources/IO/Core/CastClient';

export type ImagingStudyDownloadEntry = {
  url: string;
  fileName?: string;
  label?: string;
  source: string;
};

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function entryKey(entry: ImagingStudyDownloadEntry): string {
  return `${entry.url}|${entry.fileName || ''}`;
}

function addEntry(
  map: Map<string, ImagingStudyDownloadEntry>,
  entry: ImagingStudyDownloadEntry
): void {
  if (!isHttpUrl(entry.url)) {
    return;
  }
  map.set(entryKey(entry), entry);
}

function isNiftiHint(fileName?: string, mimeType?: string): boolean {
  const name = (fileName || '').toLowerCase();
  const mime = (mimeType || '').toLowerCase();
  return (
    name.endsWith('.nii') ||
    name.endsWith('.nii.gz') ||
    name.endsWith('.zip') ||
    mime.includes('nifti')
  );
}

function scanStudyIdentifiers(
  context: unknown,
  map: Map<string, ImagingStudyDownloadEntry>
): void {
  if (!Array.isArray(context)) {
    return;
  }
  const studyItem = context.find(
    item =>
      item &&
      typeof item === 'object' &&
      typeof (item as { key?: string }).key === 'string' &&
      (item as { key: string }).key.trim().toLowerCase() === 'study'
  );
  const resource = (studyItem as { resource?: Record<string, unknown> } | undefined)
    ?.resource;
  const identifiers = Array.isArray(resource?.identifier) ? resource.identifier : [];

  for (const identifier of identifiers) {
    if (!identifier || typeof identifier !== 'object') {
      continue;
    }
    const system =
      typeof identifier.system === 'string' ? identifier.system.trim().toLowerCase() : '';
    const value = typeof identifier.value === 'string' ? identifier.value.trim() : '';
    if (!value) {
      continue;
    }
    if (system === CAST_IDENTIFIER_NIFTI_URL.toLowerCase() && isHttpUrl(value)) {
      let fileName = '';
      const filenameIdentifier = identifiers.find(
        id =>
          typeof id?.system === 'string' &&
          id.system.trim().toLowerCase() === CAST_IDENTIFIER_NIFTI_FILENAME.toLowerCase()
      );
      if (typeof filenameIdentifier?.value === 'string') {
        fileName = filenameIdentifier.value.trim();
      }
      addEntry(map, {
        url: value,
        fileName: fileName || undefined,
        source: 'study.identifier.nifti-url',
      });
    }
  }
}

function scanContextResources(
  context: unknown,
  map: Map<string, ImagingStudyDownloadEntry>
): void {
  if (!Array.isArray(context)) {
    return;
  }

  for (const item of context) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const resource = (item as { resource?: Record<string, unknown> }).resource;
    if (!resource || typeof resource !== 'object') {
      continue;
    }

    const directUrl =
      typeof resource.url === 'string'
        ? resource.url
        : typeof resource.uri === 'string'
          ? resource.uri
          : '';
    if (isHttpUrl(directUrl)) {
      addEntry(map, {
        url: directUrl.trim(),
        fileName:
          typeof resource.fileName === 'string'
            ? resource.fileName
            : typeof resource.filename === 'string'
              ? resource.filename
              : undefined,
        label: typeof resource.label === 'string' ? resource.label : undefined,
        source: 'context.resource.url',
      });
    }

    const nestedFiles = Array.isArray(resource.files) ? resource.files : [];
    for (const fileEntry of nestedFiles) {
      if (!fileEntry || typeof fileEntry !== 'object') {
        continue;
      }
      const url =
        typeof fileEntry.url === 'string'
          ? fileEntry.url
          : typeof fileEntry.uri === 'string'
            ? fileEntry.uri
            : '';
      if (!isHttpUrl(url)) {
        continue;
      }
      addEntry(map, {
        url: url.trim(),
        fileName:
          typeof fileEntry.fileName === 'string'
            ? fileEntry.fileName
            : typeof fileEntry.filename === 'string'
              ? fileEntry.filename
              : undefined,
        label: typeof fileEntry.label === 'string' ? fileEntry.label : undefined,
        source: 'context.resource.files',
      });
    }
  }
}

/**
 * Collect every remote file URL from an ImagingStudy-open context (NIfTI, zip, etc.).
 */
export function collectImagingStudyDownloadEntries(
  context: unknown
): ImagingStudyDownloadEntry[] {
  const normalized = normalizeImagingStudyContext(context);
  const map = new Map<string, ImagingStudyDownloadEntry>();

  const fromVtk = extractImagingStudyFiles(normalized);
  for (const file of fromVtk) {
    addEntry(map, {
      url: file.url,
      fileName: file.fileName || undefined,
      label: file.label || undefined,
      source: 'extractImagingStudyFiles',
    });
  }

  const legacyNiftiUrl = extractNiftiDownloadUrl(normalized);
  if (legacyNiftiUrl) {
    addEntry(map, {
      url: legacyNiftiUrl,
      fileName: extractNiftiFilename(normalized) || undefined,
      source: 'extractNiftiDownloadUrl',
    });
  }

  scanStudyIdentifiers(normalized, map);
  scanContextResources(normalized, map);

  return [...map.values()];
}

export function hasNiftiDownloadHint(entries: ImagingStudyDownloadEntry[]): boolean {
  return entries.some(entry => isNiftiHint(entry.fileName, undefined));
}

export function toCastFileEntries(
  entries: ImagingStudyDownloadEntry[]
): CastImagingStudyFileEntry[] {
  return entries.map(entry => ({
    url: entry.url,
    fileName: entry.fileName || '',
    label: entry.label || '',
    mimeType: '',
    role: '',
  }));
}
