import type { CastMessage } from '@kitware/vtk.js/Sources/IO/Core/CastClient';
import type { FilePayload } from './types';

export function getHubEventLower(
  event: CastMessage['event'] | undefined
): string {
  const hubEvent = event?.['hub.event'];
  return typeof hubEvent === 'string' ? hubEvent.toLowerCase() : '';
}

function base64ToBytes(base64: string): Uint8Array {
  const decoded = atob(base64);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) {
    bytes[i] = decoded.charCodeAt(i);
  }
  return bytes;
}

export function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer | null {
  try {
    const bytes = base64ToBytes(base64);
    const buf = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buf).set(bytes);
    return buf;
  } catch {
    return null;
  }
}

export function batchContextFiles(
  event: CastMessage['event'] | undefined
): Array<{ data?: unknown; fileName?: string; mimeType?: string }> {
  const context = event?.context;
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return [];
  }
  const files = (context as { files?: unknown }).files;
  return Array.isArray(files)
    ? files.filter((entry): entry is { data?: unknown; fileName?: string; mimeType?: string } =>
        Boolean(entry && typeof entry === 'object')
      )
    : [];
}

function normalizeContextItems(event: CastMessage['event'] | undefined) {
  const context = event?.context;
  if (Array.isArray(context)) {
    return context;
  }
  return context != null ? [context] : [];
}

function fileEntryFromData(
  data: unknown,
  fileName: string,
  mimeType: string
): FilePayload | null {
  if (data instanceof ArrayBuffer) {
    return { arrayBuffer: data, fileName, mimeType };
  }
  if (typeof data === 'string' && data) {
    return { fileName, data, mimeType };
  }
  return null;
}

export function extractFilePayloadsForEvent(
  message: CastMessage,
  hubEventName: string
): FilePayload[] {
  const castEvent = message.event;
  if (getHubEventLower(castEvent) !== hubEventName.toLowerCase()) {
    return [];
  }

  const batchFiles = batchContextFiles(castEvent);
  if (batchFiles.length) {
    const out: FilePayload[] = [];
    for (const [idx, entry] of batchFiles.entries()) {
      const mimeType =
        typeof entry.mimeType === 'string' && entry.mimeType.trim()
          ? entry.mimeType.trim()
          : hubEventName === 'nifti-send'
            ? 'application/vnd.unknown.nifti-1'
            : 'application/dicom';
      const fileName =
        typeof entry.fileName === 'string' && entry.fileName.trim()
          ? entry.fileName.trim()
          : hubEventName === 'nifti-send'
            ? `cast-nifti-send-${idx + 1}.nii.gz`
            : `cast-dicom-send-${idx + 1}.dcm`;
      const payload = fileEntryFromData(entry.data, fileName, mimeType);
      if (payload) {
        out.push(payload);
      }
    }
    if (out.length) {
      return out;
    }
  }

  const contextItems = normalizeContextItems(castEvent);
  const out: FilePayload[] = [];
  for (const [idx, item] of contextItems.entries()) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const resource = (item as { resource?: unknown }).resource;
    if (!resource || typeof resource !== 'object') {
      continue;
    }
    const typedResource = resource as {
      data?: unknown;
      fileName?: string;
      mimeType?: string;
      contentType?: string;
    };
    const mimeType =
      typeof typedResource.mimeType === 'string' && typedResource.mimeType.trim()
        ? typedResource.mimeType.trim()
        : typeof typedResource.contentType === 'string' &&
            typedResource.contentType.trim()
          ? typedResource.contentType.trim()
          : hubEventName === 'nifti-send'
            ? 'application/vnd.unknown.nifti-1'
            : 'application/dicom';
    const fileName =
      typeof typedResource.fileName === 'string' && typedResource.fileName.trim()
        ? typedResource.fileName.trim()
        : hubEventName === 'nifti-send'
          ? `cast-nifti-send-${idx + 1}.nii.gz`
          : 'dicom-sr.dcm';
    const payload = fileEntryFromData(typedResource.data, fileName, mimeType);
    if (payload) {
      out.push(payload);
    }
  }
  return out;
}

export function filePayloadToArrayBuffer(payload: FilePayload): ArrayBuffer | null {
  if ('arrayBuffer' in payload) {
    return payload.arrayBuffer;
  }
  return decodeBase64ToArrayBuffer(payload.data);
}

export function filePayloadToFile(payload: FilePayload, defaultName: string, defaultMime: string): File | null {
  const arrayBuffer = filePayloadToArrayBuffer(payload);
  if (!arrayBuffer) {
    return null;
  }
  const fileName =
    'fileName' in payload && payload.fileName ? payload.fileName : defaultName;
  const mimeType =
    'mimeType' in payload && payload.mimeType ? payload.mimeType : defaultMime;
  return new File([arrayBuffer], fileName, { type: mimeType });
}
