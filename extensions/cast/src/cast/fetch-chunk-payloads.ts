import type { CastMessage } from '@kitware/vtk.js/Sources/IO/Core/CastClient';

type HubClient = {
  getHubConfig: () => { hub_endpoint?: string };
  getConnectionState: () => { token?: string | null };
};

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

function payloadChunkPlan(entry: Record<string, unknown>): {
  payloadIds: string[];
  chunkByteLengths: number[];
} {
  if (entry.data != null) {
    return { payloadIds: [], chunkByteLengths: [] };
  }
  const payloadIdsRaw = entry.payloadIds;
  if (Array.isArray(payloadIdsRaw) && payloadIdsRaw.length) {
    const payloadIds = payloadIdsRaw
      .map((id) => (typeof id === 'string' ? id.trim() : ''))
      .filter(Boolean);
    const chunkByteLengths = Array.isArray(entry.chunkByteLengths)
      ? entry.chunkByteLengths.filter(
          (n): n is number => typeof n === 'number' && n >= 0
        )
      : [];
    if (chunkByteLengths.length === payloadIds.length) {
      return { payloadIds, chunkByteLengths };
    }
    if (payloadIds.length === 1) {
      const byteLength = entry.byteLength;
      if (typeof byteLength === 'number' && byteLength >= 0) {
        return { payloadIds, chunkByteLengths: [byteLength] };
      }
    }
    return { payloadIds, chunkByteLengths: [] };
  }
  const legacyId = entry.payloadId;
  if (typeof legacyId === 'string' && legacyId.trim()) {
    const byteLength = entry.byteLength;
    if (typeof byteLength === 'number' && byteLength >= 0) {
      return {
        payloadIds: [legacyId.trim()],
        chunkByteLengths: [byteLength],
      };
    }
    return { payloadIds: [legacyId.trim()], chunkByteLengths: [] };
  }
  return { payloadIds: [], chunkByteLengths: [] };
}

function clearPayloadRefs(entry: Record<string, unknown>): void {
  delete entry.binaryTransfer;
  delete entry.url;
  delete entry.payloadId;
  delete entry.payloadIds;
  delete entry.chunkByteLengths;
  delete entry.expiresAt;
}

function resolvePayloadUrl(hubEndpoint: string, payloadId: string): string {
  const base = hubEndpoint.replace(/\/$/, '');
  return `${base}/api/hub/payloads/${encodeURIComponent(payloadId)}`;
}

async function downloadChunk(
  url: string,
  token: string,
  expectedLength?: number
): Promise<ArrayBuffer> {
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, { method: 'GET', credentials: 'omit', headers });
  if (!response.ok) {
    throw new Error(
      `Cast chunk GET failed: ${response.status} ${response.statusText} url=${url}`
    );
  }
  const buf = await response.arrayBuffer();
  if (
    typeof expectedLength === 'number' &&
    expectedLength >= 0 &&
    buf.byteLength !== expectedLength
  ) {
    throw new Error(
      `Cast chunk size mismatch url=${url}: expected=${expectedLength} received=${buf.byteLength}`
    );
  }
  return buf;
}

function reassembleChunks(
  chunks: ArrayBuffer[],
  expectedTotal?: number
): ArrayBuffer {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  if (
    typeof expectedTotal === 'number' &&
    expectedTotal >= 0 &&
    total !== expectedTotal
  ) {
    throw new Error(
      `Cast payload reassembly size mismatch: expected=${expectedTotal} received=${total}`
    );
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

/** Download ``payloadIds[]`` chunks when the bundled vtk CastClient predates chunk support. */
export async function fetchCastChunkPayloads(
  client: HubClient | null | undefined,
  message: CastMessage
): Promise<CastMessage> {
  const hubEndpoint = client?.getHubConfig?.()?.hub_endpoint?.trim() ?? '';
  if (!hubEndpoint) {
    throw new Error('Cast chunk fetch: missing hub_endpoint');
  }
  const token = client?.getConnectionState?.()?.token?.trim() ?? '';
  const event = message.event;
  if (!event || typeof event !== 'object') {
    return message;
  }
  const context = event.context;
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return message;
  }
  const files = (context as { files?: unknown }).files;
  if (!Array.isArray(files)) {
    return message;
  }

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const entry = files[fileIndex];
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const plan = payloadChunkPlan(entry as Record<string, unknown>);
    if (!plan.payloadIds.length || (entry as { data?: unknown }).data != null) {
      continue;
    }
    const chunkBuffers = await Promise.all(
      plan.payloadIds.map((payloadId, chunkIndex) =>
        downloadChunk(
          resolvePayloadUrl(hubEndpoint, payloadId),
          token,
          plan.chunkByteLengths[chunkIndex]
        )
      )
    );
    const expectedTotal =
      typeof (entry as { byteLength?: unknown }).byteLength === 'number'
        ? ((entry as { byteLength: number }).byteLength as number)
        : undefined;
    const assembled = reassembleChunks(chunkBuffers, expectedTotal);
    clearPayloadRefs(entry as Record<string, unknown>);
    (entry as { data: ArrayBuffer; byteLength: number }).data = assembled;
    (entry as { byteLength: number }).byteLength = assembled.byteLength;
  }
  return message;
}

export function castMessageStillNeedsChunkFetch(
  message: CastMessage | null | undefined
): boolean {
  if (!message?.event) {
    return false;
  }
  return contextFiles(message.event).some((entry) => {
    const plan = payloadChunkPlan(entry);
    return plan.payloadIds.length > 0 && entry.data == null;
  });
}
