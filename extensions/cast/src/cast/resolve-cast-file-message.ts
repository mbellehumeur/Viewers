import type { CastMessage } from '@kitware/vtk.js/Sources/IO/Core/CastClient';
import type { CastClientLike } from './types';
import { castMessageHasPendingFilePayloads } from './has-pending-file-payloads';
import {
  castMessageStillNeedsChunkFetch,
  fetchCastChunkPayloads,
} from './fetch-chunk-payloads';

export async function resolveCastFileMessage(
  client: CastClientLike | null | undefined,
  message: CastMessage
): Promise<CastMessage> {
  const pending =
    client?.hasPendingPayload?.(message) ||
    castMessageHasPendingFilePayloads(message);
  if (!pending) {
    return message;
  }
  let resolved = message;
  if (client?.fetchAllPayloads) {
    resolved = await client.fetchAllPayloads(message);
  } else if (client?.fetchPayload) {
    while (client.hasPendingPayload?.(resolved)) {
      resolved = await client.fetchPayload(resolved);
    }
  }
  if (castMessageStillNeedsChunkFetch(resolved) && client) {
    return fetchCastChunkPayloads(client, resolved);
  }
  return resolved;
}
