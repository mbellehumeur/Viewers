import type { CastMessage } from '@kitware/vtk.js/Sources/IO/Core/CastClient';

function contextFiles(
  event: CastMessage['event'] | undefined
): Record<string, unknown>[] {
  const context = event?.context;
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return [];
  }
  const files = (context as { files?: unknown }).files;
  if (!Array.isArray(files)) {
    return [];
  }
  return files.filter(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry && typeof entry === 'object')
  );
}

/** True when ``context.files[]`` still needs chunk GETs (``payloadIds[]`` or legacy ``payloadId``). */
export function castMessageHasPendingFilePayloads(
  message: CastMessage | null | undefined
): boolean {
  if (!message) {
    return false;
  }
  for (const entry of contextFiles(message.event)) {
    if (entry.data != null) {
      continue;
    }
    const payloadIds = entry.payloadIds;
    if (
      Array.isArray(payloadIds) &&
      payloadIds.some((id) => typeof id === 'string' && id.trim())
    ) {
      return true;
    }
    const payloadId = entry.payloadId;
    if (typeof payloadId === 'string' && payloadId.trim()) {
      return true;
    }
  }
  return false;
}
