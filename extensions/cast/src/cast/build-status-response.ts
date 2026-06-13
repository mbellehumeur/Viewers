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
