import JSZip from 'jszip';
import type { CastMessage } from '@kitware/vtk.js/Sources/IO/Core/CastClient';
import { navigateToCastViewer } from './cast-navigate';
import { CAST_IDC_DATA_SOURCE, LOG_PREFIX } from './constants';
import {
  filePayloadToArrayBuffer,
  type FilePayload,
} from './extract-file-payloads';
import { addCastDicomToMetadataStore } from './ingest-cast-dicom';
import { ingestNiftiFile, ingestNiftiFromUrl } from './ingest-cast-nifti';
import type { ImagingStudyIdcOpen } from './resolve-imaging-study-open';

const IDC_DOWNLOAD_CONCURRENCY = 20;

type DicomIngestCallbacks = {
  scheduleCastDicomSendLayer: (meta: {
    SeriesInstanceUID?: string;
    SOPInstanceUID?: string;
  }) => void;
};

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || path;
}

function isLikelyDicomFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith('.dcm') ||
    lower.endsWith('.dicom') ||
    !lower.includes('.') ||
    lower.endsWith('.ima')
  );
}

function isNiftiFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.nii') || lower.endsWith('.nii.gz');
}

function isZipFileName(name: string): boolean {
  return name.toLowerCase().endsWith('.zip');
}

async function isZipArchive(file: File): Promise<boolean> {
  if (isZipFileName(file.name)) {
    return true;
  }
  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04;
}

async function expandArchiveToFiles(file: File): Promise<File[]> {
  if (!(await isZipArchive(file))) {
    return [file];
  }

  const zip = await JSZip.loadAsync(file);
  const entries: File[] = [];

  await Promise.all(
    Object.keys(zip.files).map(async relPath => {
      const entry = zip.files[relPath];
      if (!entry || entry.dir) {
        return;
      }
      const name = basename(relPath);
      if (name.toLowerCase() === 'license') {
        return;
      }
      const blob = await entry.async('blob');
      entries.push(new File([blob], name, { type: blob.type || 'application/octet-stream' }));
    })
  );

  return entries;
}

async function ingestDicomFile(
  file: File,
  callbacks: DicomIngestCallbacks,
  sourceUrl?: string
): Promise<string | null> {
  const arrayBuffer = await file.arrayBuffer();
  const ingested = addCastDicomToMetadataStore(arrayBuffer, {
    fileName: file.name,
    sourceUrl,
  });
  if (!ingested) {
    return null;
  }
  callbacks.scheduleCastDicomSendLayer({
    SeriesInstanceUID: ingested.seriesInstanceUID,
    SOPInstanceUID: ingested.sopInstanceUID,
  });
  return ingested.studyUID;
}

export async function ingestCastFiles(
  files: File[],
  callbacks: DicomIngestCallbacks,
  remoteUrlByFile?: Map<File, string>
): Promise<string[]> {
  const studyUIDs = new Set<string>();

  for (const file of files) {
    if (isNiftiFileName(file.name)) {
      const studyUID = await ingestNiftiFile(
        file,
        remoteUrlByFile?.get(file),
        file.name
      );
      if (studyUID) {
        studyUIDs.add(studyUID);
      }
      continue;
    }
    if (!isLikelyDicomFileName(file.name)) {
      continue;
    }
    const studyUID = await ingestDicomFile(
      file,
      callbacks,
      remoteUrlByFile?.get(file)
    );
    if (studyUID) {
      studyUIDs.add(studyUID);
    }
  }

  return [...studyUIDs];
}

export async function fetchRemoteFile(url: string, fileName?: string): Promise<File | null> {
  try {
    console.info(`${LOG_PREFIX} downloading`, { url, fileName });
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`${LOG_PREFIX} fetch failed ${response.status}`, url);
      return null;
    }
    const blob = await response.blob();
    const name =
      fileName?.trim() ||
      basename(new URL(url).pathname) ||
      'cast-download';
    return new File([blob], name, { type: blob.type || 'application/octet-stream' });
  } catch (err) {
    console.error(`${LOG_PREFIX} fetch failed`, url, err);
    return null;
  }
}

export function extractInlineOpenFilePayloads(
  event: CastMessage['event'] | undefined
): FilePayload[] {
  const context = event?.context;
  if (!context) {
    return [];
  }

  const objectFiles =
    !Array.isArray(context) &&
    typeof context === 'object' &&
    Array.isArray((context as { files?: unknown }).files)
      ? ((context as { files: unknown[] }).files as unknown[])
      : null;

  const arrayFiles: unknown[] = [];
  if (Array.isArray(context)) {
    for (const item of context) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const resource = (item as { resource?: { files?: unknown[] } }).resource;
      if (Array.isArray(resource?.files)) {
        arrayFiles.push(...resource.files);
      }
    }
  }

  const rawFiles = objectFiles || arrayFiles;
  if (!rawFiles.length) {
    return [];
  }

  const out: FilePayload[] = [];
  for (const [idx, entry] of rawFiles.entries()) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const typed = entry as {
      data?: unknown;
      fileName?: string;
      mimeType?: string;
    };
    const fileName =
      typeof typed.fileName === 'string' && typed.fileName.trim()
        ? typed.fileName.trim()
        : `cast-open-${idx + 1}.zip`;
    const mimeType =
      typeof typed.mimeType === 'string' && typed.mimeType.trim()
        ? typed.mimeType.trim()
        : 'application/octet-stream';

    if (typed.data instanceof ArrayBuffer) {
      out.push({ arrayBuffer: typed.data, fileName, mimeType });
    } else if (typeof typed.data === 'string' && typed.data) {
      out.push({ fileName, data: typed.data, mimeType });
    }
  }
  return out;
}

async function payloadsToFiles(payloads: FilePayload[]): Promise<File[]> {
  const files: File[] = [];
  for (const [idx, payload] of payloads.entries()) {
    const arrayBuffer = filePayloadToArrayBuffer(payload);
    if (!arrayBuffer) {
      continue;
    }
    const fileName =
      'fileName' in payload && payload.fileName
        ? payload.fileName
        : `cast-open-${idx + 1}.zip`;
    files.push(
      new File([arrayBuffer], fileName, {
        type:
          'mimeType' in payload && payload.mimeType
            ? payload.mimeType
            : 'application/octet-stream',
      })
    );
  }
  return files;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!items.length) {
    return [];
  }
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

export async function loadCastIdcStudyFiles(
  plan: ImagingStudyIdcOpen,
  callbacks: DicomIngestCallbacks
): Promise<void> {
  const studyUIDs = new Set<string>();

  console.info(
    `${LOG_PREFIX} imagingstudy-open IDC parallel download (${plan.files.length} file(s), concurrency ${IDC_DOWNLOAD_CONCURRENCY})`,
    {
      studyInstanceUID: plan.studyInstanceUID,
      seriesInstanceUID: plan.seriesInstanceUID,
      sourceBucket: plan.sourceBucket,
    }
  );

  await mapWithConcurrency(plan.files, IDC_DOWNLOAD_CONCURRENCY, async entry => {
    const downloaded = await fetchRemoteFile(entry.url, entry.fileName);
    if (!downloaded || !isLikelyDicomFileName(downloaded.name)) {
      return;
    }
    const studyUID = await ingestDicomFile(downloaded, callbacks, entry.url);
    if (studyUID) {
      studyUIDs.add(studyUID);
    }
  });

  const studyList = [...studyUIDs];
  if (!studyList.length) {
    console.warn(`${LOG_PREFIX} imagingstudy-open: no studies ingested from IDC files`);
    return;
  }

  navigateToCastViewer(studyList, {
    seriesUID: plan.seriesInstanceUID,
    dataSource: CAST_IDC_DATA_SOURCE,
  });

  console.info(`${LOG_PREFIX} imagingstudy-open loaded IDC study`, {
    studyUIDs: studyList,
    fileCount: plan.files.length,
  });
}

function isDirectNiftiUrl(url: string, fileName?: string): boolean {
  const name = (fileName || basename(new URL(url).pathname)).toLowerCase();
  return isNiftiFileName(name);
}

export async function loadCastStudyFilesFromUrls(
  fileEntries: Array<{ url: string; fileName?: string; label?: string }>,
  callbacks: DicomIngestCallbacks
): Promise<void> {
  const studyUIDs = new Set<string>();

  for (const entry of fileEntries) {
    if (isDirectNiftiUrl(entry.url, entry.fileName)) {
      const studyUID = await ingestNiftiFromUrl(entry.url, entry.label || entry.fileName);
      if (studyUID) {
        studyUIDs.add(studyUID);
      }
      continue;
    }

    const downloaded = await fetchRemoteFile(entry.url, entry.fileName);
    if (!downloaded) {
      continue;
    }

    if (isNiftiFileName(downloaded.name) && !(await isZipArchive(downloaded))) {
      const studyUID = await ingestNiftiFile(
        downloaded,
        entry.url,
        entry.label || downloaded.name
      );
      if (studyUID) {
        studyUIDs.add(studyUID);
      }
      continue;
    }

    const expanded = await expandArchiveToFiles(downloaded);
    const remoteUrlByFile = new Map<File, string>();
    expanded.forEach(file => remoteUrlByFile.set(file, entry.url));
    const studyUIDsFromArchive = await ingestCastFiles(
      expanded,
      callbacks,
      remoteUrlByFile
    );
    studyUIDsFromArchive.forEach(uid => studyUIDs.add(uid));
  }

  const studyList = [...studyUIDs];
  if (!studyList.length) {
    console.warn(`${LOG_PREFIX} imagingstudy-open: no studies ingested from file URLs`);
    return;
  }

  navigateToCastViewer(studyList, { useLocalDataSource: true });

  console.info(`${LOG_PREFIX} imagingstudy-open loaded ${studyList.length} study(s)`, {
    studyUIDs: studyList,
    fileCount: fileEntries.length,
  });
}

export async function loadCastStudyFilesFromPayloads(
  payloads: FilePayload[],
  callbacks: DicomIngestCallbacks
): Promise<void> {
  const downloaded = await payloadsToFiles(payloads);
  const expanded: File[] = [];
  for (const file of downloaded) {
    const inner = await expandArchiveToFiles(file);
    expanded.push(...inner);
  }
  const studyUIDs = await ingestCastFiles(expanded, callbacks);
  if (!studyUIDs.length) {
    return;
  }
  navigateToCastViewer(studyUIDs, { useLocalDataSource: true });
}
