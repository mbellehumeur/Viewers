import {
  buildSceneviewResponsePayload,
  type SceneviewResponsePayload,
} from './build-sceneview-response';
import type { ServicesManagerLike } from './types';

export type StatusItem = {
  key: string;
  value: string;
};

export type StatusResponsePayload = {
  source: 'status';
  product: string;
  items: StatusItem[];
  sceneview: SceneviewResponsePayload;
};

export type CastRequestResponseItem = {
  id?: string | null;
  subscriber?: string | null;
  actor?: string | null;
  productName?: string | null;
  data?: unknown;
};

/** Wire product names used by TotalSegmentator resource servers. */
export const TOTAL_SEGMENTATOR_PRODUCT_ALIASES = [
  'TOTALSEG',
  'TOTAL_SEGMENTATOR',
  'TOTAL-SEGMENTATOR',
] as const;

function normalizeProductToken(name: string): string {
  return name.trim().toUpperCase().replace(/-/g, '_');
}

export function isTotalSegmentatorProduct(name: string): boolean {
  const normalized = normalizeProductToken(name);
  if (!normalized) {
    return false;
  }
  return TOTAL_SEGMENTATOR_PRODUCT_ALIASES.some(
    alias => normalizeProductToken(alias) === normalized
  );
}

export function statusItemValue(items: unknown, key: string): string | undefined {
  if (!Array.isArray(items)) {
    return undefined;
  }
  const needle = key.trim().toLowerCase();
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const item = entry as StatusItem;
    if (String(item.key ?? '').trim().toLowerCase() !== needle) {
      continue;
    }
    const value = item.value;
    return typeof value === 'string' ? value.trim() : undefined;
  }
  return undefined;
}

export function isStatusPayloadOnline(data: unknown): boolean {
  if (!data || typeof data !== 'object') {
    return false;
  }
  const payload = data as Partial<StatusResponsePayload>;
  if (payload.source !== 'status') {
    return false;
  }
  const availability = statusItemValue(payload.items, 'availability');
  if (availability) {
    return availability.toLowerCase() === 'online';
  }
  return Array.isArray(payload.items) && payload.items.length > 0;
}

export function productNameFromStatusResponseItem(
  item: CastRequestResponseItem
): string {
  const fromEnvelope = String(item.productName ?? '').trim();
  if (fromEnvelope) {
    return fromEnvelope;
  }
  const data = item.data;
  if (data && typeof data === 'object') {
    const fromPayload = String(
      (data as Partial<StatusResponsePayload>).product ?? ''
    ).trim();
    if (fromPayload) {
      return fromPayload;
    }
  }
  return '';
}

export function totalSegmentatorAvailableFromStatusResponses(
  responses: CastRequestResponseItem[]
): boolean {
  for (const item of responses) {
    const product = productNameFromStatusResponseItem(item);
    if (!isTotalSegmentatorProduct(product)) {
      continue;
    }
    if (isStatusPayloadOnline(item.data)) {
      return true;
    }
  }
  return false;
}

export function collatedResponsesFromRequestResult(
  data: unknown
): CastRequestResponseItem[] {
  if (!data || typeof data !== 'object') {
    return [];
  }
  const responses = (data as { responses?: unknown }).responses;
  return Array.isArray(responses) ? (responses as CastRequestResponseItem[]) : [];
}

export function isStatusRequestDataType(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  return value.trim().toUpperCase() === 'STATUS';
}

export function buildStatusResponsePayload(
  productName: string,
  servicesManager: ServicesManagerLike
): StatusResponsePayload {
  return {
    source: 'status',
    product: productName,
    items: [{ key: 'availability', value: 'online' }],
    sceneview: buildSceneviewResponsePayload(productName, servicesManager),
  };
}
