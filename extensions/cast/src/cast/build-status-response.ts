import {
  isStatusPayloadOnline,
  isStatusRequestDataType,
  isTotalSegmentatorProduct,
  productNameFromStatusResponseItem,
  statusItemValue,
  TOTAL_SEGMENTATOR_PRODUCT_ALIASES,
  totalSegmentatorAvailableFromStatusResponses,
} from '@kitware/vtk.js/Sources/IO/Core/CastClient';
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

export {
  isStatusPayloadOnline,
  isStatusRequestDataType,
  isTotalSegmentatorProduct,
  productNameFromStatusResponseItem,
  statusItemValue,
  TOTAL_SEGMENTATOR_PRODUCT_ALIASES,
  totalSegmentatorAvailableFromStatusResponses,
};

export function collatedResponsesFromRequestResult(
  data: unknown
): CastRequestResponseItem[] {
  if (!data || typeof data !== 'object') {
    return [];
  }
  const responses = (data as { responses?: unknown }).responses;
  return Array.isArray(responses) ? (responses as CastRequestResponseItem[]) : [];
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
