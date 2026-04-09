import dcmjs from 'dcmjs';
import { DicomMetadataStore, PubSubService, Types as OhifTypes } from '@ohif/core';
import vtkCastClient, {
  type CastClientConfig,
  type CastMessage,
  type HubConfig,
  type HubRuntimeState,
  type SessionConfig,
} from '@kitware/vtk.js/Sources/IO/Core/CastClient';

type ConfigCastHub = HubConfig & {
  events?: string[];
  lease?: number;
  productName?: string;
};

type CastConfig = {
  defaultHubName?: string;
  hubs?: ConfigCastHub[];
  productName?: string;
  autoReconnect?: boolean;
  subscriberName?: string;
  topic?: string;
  actors?: string[];
};

type ExtensionManagerLike = {
  appConfig: {
    cast?: CastConfig;
    fhircast?: CastConfig;
  };
};

type CommandsManagerLike = {
  runCommand: (commandName: string, commandOptions?: Record<string, unknown>) => void;
};

type CastLayerDisplaySet = {
  displaySetInstanceUID: string;
  SOPInstanceUID?: string;
};

type ViewportGridStateLike = {
  viewports?: Map<
    string,
    { viewportId?: string; displaySetInstanceUIDs?: string[] }
  >;
};

type ServicesManagerLike = {
  services: {
    displaySetService: {
      getDisplaySetsForSeries: (seriesInstanceUID: string) => CastLayerDisplaySet[];
    };
    viewportGridService: {
      getActiveViewportId: () => string | undefined;
      getState: () => ViewportGridStateLike;
      getDisplaySetsUIDsForViewport: (viewportId: string) => string[];
    };
  };
};

type CastClientLike = {
  onMessage: (callback: (message: CastMessage) => void) => void;
  destroy: () => void;
  getHubConfig: () => HubConfig;
  setTopic: (topic: string) => void;
  setSubscriberName: (subscriberName: string) => void;
  getToken: () => Promise<boolean>;
  subscribe: () => Promise<number | string>;
  unsubscribe: () => Promise<void>;
  publish: (castMessage: Record<string, unknown>) => Promise<Response | null>;
  getConnectionState: () => HubRuntimeState;
  getSessionConfig: () => SessionConfig;
};

const CAST_TOPIC_SESSION_KEY = 'ohif.cast.sessionTopic';

function getHubEventLower(
  event: CastMessage['event'] | undefined
): string {
  const hubEvent = event?.['hub.event'];
  return typeof hubEvent === 'string' ? hubEvent.toLowerCase() : '';
}

function normalizeStudyUID(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/^urn:oid:/i, '');
}

function extractStudyUIDFromResource(resource: unknown): string {
  if (!resource || typeof resource !== 'object') {
    return '';
  }

  const typedResource = resource as {
    uid?: unknown;
    identifier?: Array<{ system?: unknown; value?: unknown }>;
  };

  const fromUid = normalizeStudyUID(typedResource.uid);
  if (fromUid) {
    return fromUid;
  }

  const identifiers = Array.isArray(typedResource.identifier)
    ? typedResource.identifier
    : [];
  const dicomUidIdentifier = identifiers.find(
    (identifier) =>
      typeof identifier?.system === 'string' &&
      identifier.system.toLowerCase() === 'urn:dicom:uid'
  );
  return normalizeStudyUID(dicomUidIdentifier?.value);
}

export default class CastService extends PubSubService {
  public static EVENTS = {
    MESSAGE_RECEIVED: 'event::CastService:messageReceived',
  };

  public static REGISTRATION = {
    name: 'castService',
    altName: 'CastService',
    create: ({
      extensionManager,
      commandsManager,
      servicesManager,
    }: OhifTypes.Extensions.ExtensionParams) =>
      new CastService(
        extensionManager as ExtensionManagerLike,
        commandsManager as CommandsManagerLike,
        servicesManager as ServicesManagerLike
      ),
  };

  private _client: CastClientLike;
  private _commandsManager: CommandsManagerLike;
  private _servicesManager: ServicesManagerLike;

  constructor(
    extensionManager: ExtensionManagerLike,
    commandsManager: CommandsManagerLike,
    servicesManager: ServicesManagerLike
  ) {
    super(CastService.EVENTS);
    this._commandsManager = commandsManager;
    this._servicesManager = servicesManager;
    // console.info('CastService(vtk): constructor initialized');

    const castConfig = extensionManager.appConfig.cast || extensionManager.appConfig.fhircast;
    if (!castConfig) {
      throw new Error('CastService: missing cast configuration');
    }

    const defaultHubName = castConfig.defaultHubName?.trim();
    if (!defaultHubName) {
      throw new Error('CastService: cast.defaultHubName is required');
    }

    const selectedHub = (castConfig.hubs || []).find(hub => hub.name === defaultHubName);
    if (!selectedHub) {
      throw new Error(`CastService: default hub "${defaultHubName}" not found in cast.hubs`);
    }

    const callbackUrl =
      typeof window !== 'undefined' ? `${window.location.origin}/castCallback` : undefined;

    const { topic: initialTopic, preserveSessionTopicFromToken } =
      this._resolveInitialTopic(castConfig.topic);

    const vtkConfig: CastClientConfig = {
      hub: selectedHub,
      session: {
        subscriberName: castConfig.subscriberName,
        actors: castConfig.actors,
        topic: initialTopic,
        events: selectedHub.events ?? ['*'],
        lease: selectedHub.lease ?? 999,
      },
      productName: castConfig.productName ?? 'OHIF',
      callbackUrl,
      autoReconnect: castConfig.autoReconnect ?? true,
      preserveSessionTopicFromToken,
    };

    this._client = vtkCastClient.newInstance(vtkConfig) as CastClientLike;
    // console.info('CastService(vtk): client created', {
    //   hub: selectedHub.name,
    //   endpoint: selectedHub.hub_endpoint,
    // });

    this._client.onMessage((message: CastMessage) => {
      this._handleImagingStudyOpen(message);
      this._handleImagingStudyClose(message);
      this._handleDicomSend(message);
    });

    void this._start();
  }

  public destroy(): void {
    this._client.destroy();
  }

  public getHub(): HubConfig {
    return this._client.getHubConfig();
  }

  public setTopic(topic: string): void {
    this._client.setTopic(topic);
    this._writeStoredTopic(topic);
  }

  public setSubscriberName(subscriberName: string): void {
    this._client.setSubscriberName(subscriberName);
  }

  public async getToken(): Promise<boolean> {
    return this._client.getToken();
  }

  public async castSubscribe(): Promise<number | string> {
    return this._client.subscribe();
  }

  public async castUnsubscribe(): Promise<void> {
    return this._client.unsubscribe();
  }

  public async castPublish(castMessage: Record<string, unknown>): Promise<Response | null> {
    return this._client.publish(castMessage);
  }

  public getConnectionState() {
    return this._client.getConnectionState();
  }

  public getSessionConfig() {
    return this._client.getSessionConfig();
  }

  private _readStoredTopic(): string {
    if (typeof window === 'undefined') {
      return '';
    }
    try {
      return window.sessionStorage.getItem(CAST_TOPIC_SESSION_KEY)?.trim() ?? '';
    } catch {
      return '';
    }
  }

  private _writeStoredTopic(topic: string): void {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const trimmed = topic.trim();
      if (trimmed) {
        window.sessionStorage.setItem(CAST_TOPIC_SESSION_KEY, trimmed);
      } else {
        window.sessionStorage.removeItem(CAST_TOPIC_SESSION_KEY);
      }
    } catch {
      // private mode / quota
    }
  }

  private _resolveInitialTopic(configTopic?: string): {
    topic: string;
    preserveSessionTopicFromToken: boolean;
  } {
    const fromUrl =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('topic')?.trim() ?? ''
        : '';
    if (fromUrl) {
      return { topic: fromUrl, preserveSessionTopicFromToken: true };
    }
    const fromStorage = this._readStoredTopic();
    if (fromStorage) {
      return { topic: fromStorage, preserveSessionTopicFromToken: true };
    }
    return {
      topic: configTopic?.trim() ?? '',
      preserveSessionTopicFromToken: false,
    };
  }

  private async _start(): Promise<void> {
    // console.info('CastService(vtk): starting token + subscribe flow');
    const tokenOk = await this.getToken();
    // console.info('CastService(vtk): token result', tokenOk);
    if (!tokenOk) {
      return;
    }
    await this.castSubscribe();
    const topicAfterStart = this._client.getSessionConfig().topic?.trim() ?? '';
    if (topicAfterStart) {
      this._writeStoredTopic(topicAfterStart);
    }
  }

  private _handleImagingStudyOpen(message: CastMessage): void {
    const event = message.event;
    if (getHubEventLower(event) !== 'imagingstudy-open') {
      return;
    }
    const contextItems = Array.isArray(event.context)
      ? (event.context as Array<{ key?: string; resource?: unknown }>)
      : [];
    const studyResource = contextItems.find(item => item.key === 'study')?.resource;
    const studyUID = extractStudyUIDFromResource(studyResource);
    if (!studyUID) {
      return;
    }
    const currentLocation =
      typeof window !== 'undefined' ? window.location.toString() : '';
    if (currentLocation.includes(studyUID)) {
      return;
    }
    this._commandsManager.runCommand('navigateHistory', {
      to: '/viewer?StudyInstanceUIDs=' + studyUID + '&Cast',
    });
  }

  private _handleImagingStudyClose(message: CastMessage): void {
    const event = message.event;
    if (getHubEventLower(event) !== 'imagingstudy-close') {
      return;
    }
    this._commandsManager.runCommand('navigateHistory', {
      to: '/',
    });
  }

  private _handleDicomSend(message: CastMessage): void {
    if (typeof window === 'undefined') {
      return;
    }
    const payload = extractDicomPayload(message);
    if (!payload) {
      return;
    }
    const arrayBuffer =
      'arrayBuffer' in payload
        ? payload.arrayBuffer
        : (() => {
            const binary = base64ToBytes(payload.data);
            const buf = new ArrayBuffer(binary.byteLength);
            new Uint8Array(buf).set(binary);
            return buf;
          })();
    try {
      const dicomData = dcmjs.data.DicomMessage.readFile(arrayBuffer);
      let dicomJSONDataset = dicomData.dict;
      const naturalizedDataset =
        dicomJSONDataset.SeriesInstanceUID === undefined
          ? dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomJSONDataset)
          : dicomJSONDataset;
      const studyUID = naturalizedDataset.StudyInstanceUID;
      if (!studyUID) {
        return;
      }
      naturalizedDataset._castDicomArrayBuffer = arrayBuffer.slice(0);
      const blob = new Blob([arrayBuffer], { type: 'application/dicom' });
      naturalizedDataset.url = URL.createObjectURL(blob);
      DicomMetadataStore.addInstances([naturalizedDataset], true);
      const currentLocation =
        typeof window !== 'undefined' ? window.location.toString() : '';
      if (!currentLocation.includes(studyUID)) {
        this._commandsManager.runCommand('navigateHistory', {
          to: '/viewer?StudyInstanceUIDs=' + studyUID + '&Cast',
        });
      }
      this._scheduleCastDicomSendLayer({
        SeriesInstanceUID: naturalizedDataset.SeriesInstanceUID as string | undefined,
        SOPInstanceUID: naturalizedDataset.SOPInstanceUID as string | undefined,
      });
    } catch (err) {
      void err;
      // console.error('CastService(vtk): dicom-send handling failed', err);
    }
  }

  private _scheduleCastDicomSendLayer(meta: {
    SeriesInstanceUID?: string;
    SOPInstanceUID?: string;
  }): void {
    if (typeof window === 'undefined') {
      return;
    }
    let done = false;
    let attempt = 0;
    const maxAttempts = 24;
    const intervalMs = 300;
    const tryAdd = () => {
      if (done || attempt++ > maxAttempts) {
        return;
      }
      done = this._addCastDicomSendAsLayer(meta);
      if (!done) {
        window.setTimeout(tryAdd, intervalMs);
      }
    };
    queueMicrotask(tryAdd);
  }

  private _resolveCastLayerViewportId(): string | undefined {
    const { viewportGridService } = this._servicesManager.services;
    const active = viewportGridService.getActiveViewportId();
    if (active) {
      return active;
    }
    const viewports = viewportGridService.getState()?.viewports;
    if (!viewports?.size) {
      return undefined;
    }
    for (const [mapKey, vp] of viewports) {
      if (vp?.displaySetInstanceUIDs?.length) {
        return vp.viewportId ?? mapKey;
      }
    }
    const firstKey = viewports.keys().next();
    return firstKey.done ? undefined : firstKey.value;
  }

  private _addCastDicomSendAsLayer(meta: {
    SeriesInstanceUID?: string;
    SOPInstanceUID?: string;
  }): boolean {
    const { SeriesInstanceUID, SOPInstanceUID } = meta;
    if (!SeriesInstanceUID) {
      return false;
    }

    const { displaySetService, viewportGridService } = this._servicesManager.services;
    const viewportId = this._resolveCastLayerViewportId();
    if (!viewportId) {
      return false;
    }

    const candidates = displaySetService.getDisplaySetsForSeries(SeriesInstanceUID);
    if (!candidates?.length) {
      return false;
    }

    const displaySet =
      (SOPInstanceUID &&
        candidates.find(ds => ds.SOPInstanceUID === SOPInstanceUID)) ??
      candidates[candidates.length - 1];

    if (!displaySet?.displaySetInstanceUID) {
      return false;
    }

    const uid = displaySet.displaySetInstanceUID;
    const currentUids = viewportGridService.getDisplaySetsUIDsForViewport(viewportId) ?? [];
    if (currentUids.includes(uid)) {
      return true;
    }

    this._commandsManager.runCommand('addDisplaySetAsLayer', {
      viewportId,
      displaySetInstanceUID: uid,
    });
    return true;
  }
}

type DicomSendPayload =
  | { arrayBuffer: ArrayBuffer }
  | { fileName: string; data: string; mimeType: string };

function extractDicomPayload(message: CastMessage): DicomSendPayload | null {
  const castEvent = message.event;
  if (getHubEventLower(castEvent) !== 'dicom-send') {
    return null;
  }
  const context = castEvent.context;
  const contextItems = Array.isArray(context) ? context : context != null ? [context] : [];
  for (const item of contextItems) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const resource = (item as { resource?: unknown }).resource;
    if (!resource || typeof resource !== 'object') {
      continue;
    }
    const data = (resource as { data?: unknown }).data;
    if (data instanceof ArrayBuffer) {
      return { arrayBuffer: data };
    }
    if (typeof data === 'string' && data) {
      const fileName =
        typeof (resource as { fileName?: unknown }).fileName === 'string'
          ? (resource as { fileName: string }).fileName || 'dicom-sr.dcm'
          : 'dicom-sr.dcm';
      const mimeType =
        typeof (resource as { mimeType?: unknown }).mimeType === 'string'
          ? (resource as { mimeType: string }).mimeType || 'application/dicom'
          : 'application/dicom';
      return { fileName, data, mimeType };
    }
  }
  return null;
}

function base64ToBytes(base64: string): Uint8Array {
  const decoded = atob(base64);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    bytes[i] = decoded.charCodeAt(i);
  }
  return bytes;
}
