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
  productVersion?: string;
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
  onConnectionStateChange: (
    callback: (state: string, detail?: unknown) => void
  ) => void;
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
  sendCastRequestResponse: (requestId: string, data: unknown, topic?: string) => void;
  request: (args: {
    subscriber: string;
    topic?: string;
    dataType?: string;
    actor?: string;
    endpoint?: string;
  }) => Promise<{ ok: boolean; status: number; data: unknown }>;
};

const CAST_TOPIC_SESSION_KEY = 'ohif.cast.sessionTopic';
const ID_ACTOR_KEYWORD = 'ID';
const SUBSCRIBER_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function ensureIdActor(actors?: string[]): string[] {
  const list = Array.isArray(actors) ? actors.filter(Boolean) : [];
  return list.includes(ID_ACTOR_KEYWORD) ? list : [...list, ID_ACTOR_KEYWORD];
}

function generateSubscriberName(productName: string): string {
  const base =
    productName.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') ||
    'OHIF';
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += SUBSCRIBER_ID_ALPHABET[Math.floor(Math.random() * SUBSCRIBER_ID_ALPHABET.length)];
  }
  return `${base}-${suffix}`;
}

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

function getActorKeyword(actor: unknown): string {
  if (typeof actor === 'string') {
    return actor.trim().toUpperCase();
  }
  if (!actor || typeof actor !== 'object') {
    return '';
  }
  const typedActor = actor as { keyword?: unknown; id?: unknown; key?: unknown };
  const value =
    (typeof typedActor.keyword === 'string' && typedActor.keyword) ||
    (typeof typedActor.id === 'string' && typedActor.id) ||
    (typeof typedActor.key === 'string' && typedActor.key) ||
    '';
  return value.trim().toUpperCase();
}

function decodeTopicFromJwt(token: string): string {
  try {
    const parts = token.split('.');
    if (parts.length < 2) {
      return '';
    }
    const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const paddingLength = (4 - (payloadBase64.length % 4)) % 4;
    const paddedPayload = payloadBase64 + '='.repeat(paddingLength);
    const payloadJson = atob(paddedPayload);
    const payload = JSON.parse(payloadJson) as { topic?: unknown };
    return typeof payload.topic === 'string' ? payload.topic.trim() : '';
  } catch {
    return '';
  }
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

    const productName = castConfig.productName ?? 'OHIF';
    const productVersion = castConfig.productVersion ?? '1.0';
    const subscriberName =
      castConfig.subscriberName?.trim() || generateSubscriberName(productName);

    const vtkConfig: CastClientConfig = {
      hub: selectedHub,
      session: { 
        actors: ensureIdActor(castConfig.actors),
        topic: initialTopic,
        events: selectedHub.events ?? ['*'],
        lease: selectedHub.lease ?? 999,
        productName,
        productVersion,
        subscriberName,
      },
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
      this._handleCastRequest(message);
      this._handleCastResponse(message);
      this._handleImagingStudyOpen(message);
      this._handleImagingStudyClose(message);
      this._handleDicomSend(message);
    });
    this._client.onConnectionStateChange((wsState: string) => {
      if (wsState === 'connected') {
        void this._requestFhircastContext();
      }
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
    const subscribeResult = await this._client.subscribe();
    console.info('CastService(vtk): castSubscribe result', subscribeResult);
    if (subscribeResult !== 202) {
      console.warn(
        'CastService(vtk): skipping auto FHIRcastContext GET; subscribe did not return 202'
      );
    }
    return subscribeResult;
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

  private async _requestFhircastContext(): Promise<void> {
    const sessionConfig = this._client.getSessionConfig();
    const subscriber = sessionConfig.subscriberName?.trim() ?? '';
    if (!subscriber) {
      console.warn(
        'CastService(vtk): missing subscriber for FHIRcastContext request'
      );
      return;
    }

    try {
      console.info(
        'CastService(vtk): requesting FHIRcastContext after websocket connected'
      );
      const result = await this._client.request({
        subscriber,
        dataType: 'FHIRcastContext',
        actor: 'WORKLIST_CLIENT',
      });

      if (!result.ok) {
        console.warn(
          'CastService(vtk): auto FHIRcastContext GET returned non-OK response',
          result.status,
          result.data
        );
        return;
      }

      console.info(
        'CastService(vtk): auto FHIRcastContext GET accepted',
        result.status,
        result.data
      );

      const responseEvent = (
        result.data as { response?: { event?: CastMessage['event'] } }
      )?.response?.event;
      if (responseEvent) {
        this._handleCastResponseEvent(responseEvent);
      }
    } catch (err) {
      console.error('CastService(vtk): failed to request FHIRcastContext', err);
    }
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
    const stripCastParamsFromUrl = () => {
      if (typeof window === 'undefined' || !window.history?.replaceState) {
        return;
      }
      const url = new URL(window.location.href);
      const hasTopic = url.searchParams.has('topic');
      const hasCastToken = url.searchParams.has('cast-token');
      if (!hasTopic && !hasCastToken) {
        return;
      }
      url.searchParams.delete('topic');
      url.searchParams.delete('cast-token');
      window.history.replaceState(null, '', url.toString());
    };

    const searchParams =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const fromUrl = searchParams?.get('topic')?.trim() ?? '';
    if (fromUrl) {
      stripCastParamsFromUrl();
      return { topic: fromUrl, preserveSessionTopicFromToken: true };
    }

    const castToken = searchParams?.get('cast-token')?.trim() ?? '';
    const fromCastToken = castToken ? decodeTopicFromJwt(castToken) : '';
    if (fromCastToken) {
      stripCastParamsFromUrl();
      return { topic: fromCastToken, preserveSessionTopicFromToken: true };
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

  private _handleCastResponse(message: CastMessage): void {
    const event = message.event;
    if (getHubEventLower(event) !== 'cast-response') {
      return;
    }
    this._handleCastResponseEvent(event);
  }

  private _handleCastRequest(message: CastMessage): void {
    const event = message.event;
    if (getHubEventLower(event) !== 'cast-request') {
      return;
    }

    const context = event.context as { requestId?: unknown; dataType?: unknown } | undefined;
    const requestId = context?.requestId;
    if (typeof requestId !== 'string' || !requestId) {
      return;
    }

    const dataType = typeof context?.dataType === 'string' ? context.dataType : '';
    const normalizedDataType = dataType.trim().toUpperCase();
    if (
      normalizedDataType !== 'PNGFULLSIZE' &&
      normalizedDataType !== 'JPGFULLSIZE' &&
      normalizedDataType !== 'PNGTHUMBNAIL' &&
      normalizedDataType !== 'JPGTHUMBNAIL'
    ) {
      return;
    }

    const actorKeyword = getActorKeyword((message as { actor?: unknown }).actor);
    if (actorKeyword !== ID_ACTOR_KEYWORD) {
      return;
    }

    const image =
      normalizedDataType === 'PNGTHUMBNAIL'
        ? { contentType: 'image/png', data: this._captureViewerPngThumbnailBase64() }
        : normalizedDataType === 'JPGTHUMBNAIL'
          ? { contentType: 'image/jpeg', data: this._captureViewerJpegThumbnailBase64() }
          : { contentType: 'image/png', data: this._captureViewerPngBase64() };

    if (!image.data) {
      return;
    }

    this._client.sendCastRequestResponse(
      requestId,
      {
        'context.type': 'Image',
        context: [
          {
            key: 'image',
            resource: {
              resourceType: 'Binary',
              contentType: image.contentType,
              data: image.data,
            },
          },
        ],
      },
      event['hub.topic']
    );
  }

  private _getPreferredViewerCanvas(): HTMLCanvasElement | null {
    if (typeof document === 'undefined') {
      return null;
    }
    const canvases = Array.from(
      document.querySelectorAll<HTMLCanvasElement>('canvas')
    ).filter((canvas) => canvas.width > 0 && canvas.height > 0);
    if (!canvases.length) {
      return null;
    }
    return (
      canvases.find((c) => c.closest('.viewport-element, [data-viewport-id]')) ||
      canvases[0] ||
      null
    );
  }

  private _captureViewerPngBase64(): string {
    const canvas = this._getPreferredViewerCanvas();
    if (!canvas) {
      return '';
    }
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const marker = 'base64,';
      const idx = dataUrl.indexOf(marker);
      return idx >= 0 ? dataUrl.slice(idx + marker.length) : '';
    } catch {
      return '';
    }
  }

  private _captureViewerPngThumbnailBase64(maxWidth = 160): string {
    if (typeof document === 'undefined') {
      return '';
    }
    const source = this._getPreferredViewerCanvas();
    if (!source) {
      return '';
    }

    const scale = Math.min(1, maxWidth / source.width);
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));

    const thumb = document.createElement('canvas');
    thumb.width = width;
    thumb.height = height;
    const ctx = thumb.getContext('2d');
    if (!ctx) {
      return '';
    }
    try {
      ctx.drawImage(source, 0, 0, width, height);
      const dataUrl = thumb.toDataURL('image/png');
      const marker = 'base64,';
      const idx = dataUrl.indexOf(marker);
      return idx >= 0 ? dataUrl.slice(idx + marker.length) : '';
    } catch {
      return '';
    }
  }

  private _captureViewerJpegThumbnailBase64(
    maxWidth = 160,
    quality = 0.85
  ): string {
    if (typeof document === 'undefined') {
      return '';
    }
    const source = this._getPreferredViewerCanvas();
    if (!source) {
      return '';
    }

    const scale = Math.min(1, maxWidth / source.width);
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));

    const thumb = document.createElement('canvas');
    thumb.width = width;
    thumb.height = height;
    const ctx = thumb.getContext('2d');
    if (!ctx) {
      return '';
    }
    try {
      ctx.drawImage(source, 0, 0, width, height);
      const dataUrl = thumb.toDataURL('image/jpeg', quality);
      const marker = 'base64,';
      const idx = dataUrl.indexOf(marker);
      return idx >= 0 ? dataUrl.slice(idx + marker.length) : '';
    } catch {
      return '';
    }
  }

  private _handleCastResponseEvent(event: CastMessage['event']): void {
    const data = (event.context as { data?: unknown } | undefined)?.data;
    this._openStudyFromContextData(data);
  }

  private _openStudyFromContextData(data: unknown): void {
    if (!data || typeof data !== 'object') {
      return;
    }

    const typedData = data as {
      'context.type'?: unknown;
      context?: Array<{ key?: string; resource?: unknown }> | unknown;
    };
    if (typedData['context.type'] !== 'ImagingStudy') {
      return;
    }

    const contextItems = Array.isArray(typedData.context) ? typedData.context : [];
    const studyResource = contextItems.find(item => item?.key === 'study')?.resource;
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
      to: '/viewer/',
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
