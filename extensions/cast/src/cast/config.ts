import {
  ensureCastSubscribeEvents,
  isHubEndpointInCloud,
  isRunningInCloud,
} from '@kitware/vtk.js/Sources/IO/Core/CastClient';
import type { HubConfig } from '@kitware/vtk.js/Sources/IO/Core/CastClient';

export { ensureCastSubscribeEvents };

export type ConfigCastHub = HubConfig & {
  events?: string[];
  lease?: number;
  productName?: string;
};

export type CastConfig = {
  defaultHubName?: string;
  hubs?: ConfigCastHub[];
  productName?: string;
  productVersion?: string;
  autoReconnect?: boolean;
  autoSelectHub?: boolean;
  subscriberName?: string;
  topic?: string;
  actors?: string[];
};

function hubNameFromConfig(hub: ConfigCastHub): string {
  return typeof hub?.name === 'string' ? hub.name.trim() : '';
}

function hubEndpointFromConfig(hub: ConfigCastHub): string {
  return typeof hub?.hub_endpoint === 'string' ? hub.hub_endpoint.trim() : '';
}

export function selectHubFromCastConfig(
  hubs: ConfigCastHub[],
  defaultHubName: string,
  autoSelectHub: boolean
): ConfigCastHub | undefined {
  if (!hubs.length) {
    return undefined;
  }

  const defaultHub = hubs.find(hub => hubNameFromConfig(hub) === defaultHubName);

  if (!autoSelectHub) {
    return defaultHub;
  }

  const pageInCloud = isRunningInCloud();
  const deploymentMatched = hubs.find(hub => {
    const endpoint = hubEndpointFromConfig(hub);
    return endpoint && isHubEndpointInCloud(endpoint) === pageInCloud;
  });

  return deploymentMatched ?? defaultHub;
}

export function resolveCastHub(castConfig: CastConfig): ConfigCastHub {
  const defaultHubName = castConfig.defaultHubName?.trim();
  if (!defaultHubName) {
    throw new Error('CastService: cast.defaultHubName is required');
  }

  const hubs = castConfig.hubs ?? [];
  const selectedHub = selectHubFromCastConfig(
    hubs,
    defaultHubName,
    castConfig.autoSelectHub ?? false
  );

  if (!selectedHub) {
    throw new Error(`CastService: default hub "${defaultHubName}" not found in cast.hubs`);
  }

  return selectedHub;
}
