import { PubSubService, Types as OhifTypes } from '@ohif/core';
import vtkCastClient, {
  type CastClientConfig,
  type CastMessage,
  type HubConfig,
  generateSubscriberName,
} from '@kitware/vtk.js/Sources/IO/Core/CastClient';
import {
  buildStatusResponsePayload,
  isStatusRequestDataType,
  totalSegmentatorAvailableFromStatusResponses,
} from '../../cast/build-status-response';
import {
  CAST_PRODUCT_NAME,
  CAST_TOPIC_SESSION_KEY,
  LOG_PREFIX,
} from '../../cast/constants';
import {
  CastConfig,
  ensureCastSubscribeEvents,
  resolveCastHub,
} from '../../cast/config';
import {
  applyCastPublishEnvelopeFields,
  DEFAULT_CAST_PUBLISH_ENVELOPE_FIELDS,
  type CastPublishEnvelopeFields,
  resolveCastPublishEnvelopeFields,
} from '../../cast/envelope-fields';
import { getHubEventLower } from '../../cast/extract-file-payloads';
import { buildGetRequestImagePayload, normalizeGetRequestDataType } from '../../cast/get-response-image';
import { tryApplyPendingUsAnnotations } from '../../cast/import-us-annotations';
import {
  handleAnnotationEvent,
  ImagingStudyHandler,
} from '../../cast/imaging-study-handler';
import {
  handleDicomSendMessage,
  handleNiftiSendMessage,
} from '../../cast/dicom-send-handler';
import {
  buildTotalSegmentatorSendManifestFromActiveSeries,
} from '../../cast/publish/build-dicom-send-url-manifest';
import {
  buildDicomSendFromActiveSeries,
  buildDicomSendFromActiveStudy,
  buildDicomSendFromSlice,
  buildDicomSendFromStudy,
  type DicomSendFileEntry,
} from '../../cast/publish/build-dicom-send-from-display-set';
import {
  normalizeTotalSegmentatorOptions,
  type TotalSegmentatorOptions,
} from '../../cast/total-segmentator-options';
import {
  CAST_CONFERENCE_POLL_MS,
  normalizeConferenceParticipants,
  resolveCastConferenceState,
} from '../../cast/conference-status';
import {
  buildCastHeaderStatus,
  castHeaderStatusEqual,
  type CastHeaderStatusState,
} from '../../cast/cast-header-status';
import { resolveCastFileMessage } from '../../cast/resolve-cast-file-message';
import {
  showImagingStudyOpenLoadingNotification,
  type ImagingStudyOpenResult,
} from '../../cast/imaging-study-open-notification';
import type {
  CastClientLike,
  CommandsManagerLike,
  ServicesManagerLike,
} from '../../cast/types';
import {
  DEFAULT_TARGET_ACTOR_KEYWORD,
  ID_ACTOR_KEYWORD,
} from '../../cast/types';
import {
  isRequestEvent,
  requestEventFor,
} from './event-names';

type ExtensionManagerLike = {
  appConfig: {
    cast?: CastConfig;
    fhircast?: CastConfig;
  };
};

type CastRequestResponseItem = {
  id: string | null;
  subscriber: string | null;
  actor: string | null;
  productName?: string | null;
  data?: unknown;
};

type CastRequestEnvelope = {
  responses?: CastRequestResponseItem[];
};

function ensureIdActor(actors?: string[]): string[] {
  const list = Array.isArray(actors) ? actors.filter(Boolean) : [];
  return list.includes(ID_ACTOR_KEYWORD) ? list : [...list, ID_ACTOR_KEYWORD];
}

function getInboundTargetActorKeyword(message: {
  'target.actor'?: unknown;
}): string {
  const dotted = message['target.actor'];
  if (dotted === undefined || dotted === null) {
    return '';
  }
  return getActorKeyword(dotted);
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
    STATUS_CHANGED: 'event::CastService:statusChanged',
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
  private _imagingStudyHandler: ImagingStudyHandler;
  private _publishEnvelopeFields: CastPublishEnvelopeFields =
    DEFAULT_CAST_PUBLISH_ENVELOPE_FIELDS;
  private _subscriberName = '';
  private _productName = CAST_PRODUCT_NAME;
  /** Hub access token from worklist deep-link (`id-token` query); skips OAuth when set. */
  private _urlHubAccessToken = '';
  private _wsState = '';
  private _totalSegmentatorAvailable = false;
  private _totalSegmentatorJobStatus = '';
  private _conferenceActive = false;
  private _conferenceTitle = '';
  private _conferenceParticipants: string[] = [];
  private _conferencePollTimer: ReturnType<typeof setInterval> | null = null;
  private _lastBroadcastHeaderStatus: CastHeaderStatusState | null = null;
  private _statusRequestedForSession = false;

  constructor(
    extensionManager: ExtensionManagerLike,
    commandsManager: CommandsManagerLike,
    servicesManager: ServicesManagerLike
  ) {
    super(CastService.EVENTS);
    this._commandsManager = commandsManager;
    this._servicesManager = servicesManager;

    const castConfig = extensionManager.appConfig.cast || extensionManager.appConfig.fhircast;
    if (!castConfig) {
      throw new Error('CastService: missing cast configuration');
    }

    const selectedHub = resolveCastHub(castConfig);
    const callbackUrl =
      typeof window !== 'undefined' ? `${window.location.origin}/castCallback` : undefined;

    const { topic: initialTopic, preserveSessionTopicFromToken } =
      this._resolveInitialTopic(castConfig.topic);

    const productName = castConfig.productName ?? CAST_PRODUCT_NAME;
    this._productName = productName;
    const productVersion = castConfig.productVersion ?? '1.0';
    const subscriberName =
      castConfig.subscriberName?.trim() || generateSubscriberName(productName);
    this._subscriberName = subscriberName;
    this._publishEnvelopeFields = resolveCastPublishEnvelopeFields(
      {},
      { subscriberName }
    );

    const vtkConfig: CastClientConfig = {
      hub: selectedHub,
      session: {
        actors: ensureIdActor(castConfig.actors),
        topic: initialTopic,
        events: ensureCastSubscribeEvents(selectedHub.events ?? ['*']),
        lease: selectedHub.lease ?? 999,
        productName,
        productVersion,
        subscriberName,
        defaultTargetActor: DEFAULT_TARGET_ACTOR_KEYWORD,
      },
      callbackUrl,
      autoReconnect: castConfig.autoReconnect ?? true,
      preserveSessionTopicFromToken,
    };

    this._client = vtkCastClient.newInstance(vtkConfig) as CastClientLike;

    this._imagingStudyHandler = new ImagingStudyHandler({
      scheduleCastDicomSendLayer: meta => this._scheduleCastDicomSendLayer(meta),
    });

    this._registerMessageHandlers();

    this._client.onConnectionStateChange((wsState: string) => {
      this._broadcastCastStatus(wsState);
      if (wsState === 'connected') {
        if (!this._statusRequestedForSession) {
          this._statusRequestedForSession = true;
          void this._requestStatus();
        }
        this._startConferencePoll();
      } else if (wsState === 'disconnected' || wsState === 'error') {
        this._statusRequestedForSession = false;
        this._totalSegmentatorAvailable = false;
        this._totalSegmentatorJobStatus = '';
        this._stopConferencePoll();
        this._setConferenceActive(false);
      }
    });

    void this._start();
  }

  public destroy(): void {
    this._stopConferencePoll();
    this._client.delete();
  }

  public getHub(): HubConfig {
    return this._client.getHubConfig();
  }

  public setTopic(topic: string): void {
    this._client.setTopic(topic);
    this._writeStoredTopic(topic);
    this._broadcastCastStatus();
  }

  public getCastHeaderStatus() {
    const topic = this._client.getSessionConfig().topic?.trim() ?? '';
    const hub = this._client.getHubConfig();
    const hubLabel = hub.friendlyName?.trim() || hub.name?.trim() || 'Hub';
    const subscriberName =
      this._subscriberName.trim() ||
      this._client.getSessionConfig().subscriberName?.trim() ||
      '';
    return buildCastHeaderStatus(
      topic,
      hubLabel,
      subscriberName,
      this._wsState,
      this._totalSegmentatorAvailable,
      this._totalSegmentatorJobStatus,
      this._conferenceActive,
      this._conferenceTitle,
      this._conferenceParticipants
    );
  }

  public setTotalSegmentatorAvailable(available: boolean): void {
    this._totalSegmentatorAvailable = available;
  }

  public clearTotalSegmentatorJobStatus(): void {
    this._totalSegmentatorJobStatus = '';
    this._broadcastCastStatus();
  }

  public appendTotalSegmentatorJobStatusLine(line: string): void {
    const text = String(line ?? '').trim();
    if (!text) {
      return;
    }
    const current = this._totalSegmentatorJobStatus;
    this._totalSegmentatorJobStatus = current ? `${current}\n${text}` : text;
  }

  public setConferenceActive(
    active: boolean,
    title = '',
    participants?: string[]
  ): void {
    this._setConferenceActive(active, title, participants);
  }

  public setSubscriberName(subscriberName: string): void {
    this._subscriberName = subscriberName;
    this._client.setSubscriberName(subscriberName);
    this._publishEnvelopeFields = resolveCastPublishEnvelopeFields(
      { subscriberName },
      { subscriberName }
    );
  }

  public setPublishEnvelopeFields(fields: Partial<CastPublishEnvelopeFields>): void {
    this._publishEnvelopeFields = resolveCastPublishEnvelopeFields(
      { ...this._publishEnvelopeFields, ...fields },
      { subscriberName: this._subscriberName }
    );
  }

  public async authenticate() {
    return this._client.authenticate();
  }

  public async getToken(): Promise<boolean> {
    const { code } = await this.authenticate();
    if (!code) {
      return false;
    }
    return this._client.getToken(code);
  }

  public async castSubscribe(): Promise<number | string> {
    const subscribeResult = await this._client.subscribe();
    console.info(`${LOG_PREFIX} castSubscribe result`, subscribeResult);
    return subscribeResult;
  }

  public async castUnsubscribe(): Promise<void> {
    return this._client.unsubscribe();
  }

  public async castPublish(
    castMessage: Record<string, unknown>,
    envelopeOverride?: Partial<CastPublishEnvelopeFields>
  ): Promise<Response | null> {
    const message = { ...castMessage } as CastMessage;
    const fields = resolveCastPublishEnvelopeFields(
      { ...this._publishEnvelopeFields, ...envelopeOverride },
      { subscriberName: this._subscriberName }
    );
    applyCastPublishEnvelopeFields(message, fields);
    return this._client.publish(message);
  }

  public getConnectionState() {
    return this._client.getConnectionState();
  }

  public getSessionConfig() {
    return this._client.getSessionConfig();
  }

  public async publishDicomSendSeries(): Promise<Response | null> {
    const files = await buildDicomSendFromActiveSeries(this._servicesManager);
    return this._publishBinaryBatchFiles('dicom-send', files);
  }

  public async publishDicomSendStudy(): Promise<Response | null> {
    const files = await buildDicomSendFromActiveStudy(this._servicesManager);
    return this._publishBinaryBatchFiles('dicom-send', files);
  }

  public async publishDicomSendSlice(
    studyInstanceUID: string,
    seriesInstanceUID: string,
    sopInstanceUID: string
  ): Promise<Response | null> {
    const files = await buildDicomSendFromSlice(
      studyInstanceUID,
      seriesInstanceUID,
      sopInstanceUID
    );
    return this._publishBinaryBatchFiles('dicom-send', files);
  }

  public async publishDicomSendFromStudyUid(
    studyInstanceUID: string,
    scope: 'study' | 'series' = 'series',
    seriesInstanceUID?: string
  ): Promise<Response | null> {
    const files = await buildDicomSendFromStudy(
      studyInstanceUID,
      scope,
      seriesInstanceUID
    );
    return this._publishBinaryBatchFiles('dicom-send', files);
  }

  /**
   * Send the active series to TotalSegmentator via URL-only publish (no binary batch).
   */
  public async publishTotalSegmentatorSend(
    options: Partial<TotalSegmentatorOptions> = {}
  ): Promise<Response | null> {
    const topic = this._client.getSessionConfig().topic?.trim() ?? '';
    if (!topic) {
      throw new Error('Cast topic is not configured');
    }

    const manifest = buildTotalSegmentatorSendManifestFromActiveSeries(this._servicesManager);
    const totalSegmentator = normalizeTotalSegmentatorOptions(options);

    return this.castPublish(
      {
        event: {
          'hub.topic': topic,
          'hub.event': manifest.hubEvent,
          context: {
            files: manifest.files,
            totalSegmentator,
          },
        },
      },
      { targetActor: DEFAULT_TARGET_ACTOR_KEYWORD }
    );
  }

  private async _publishBinaryBatchFiles(
    hubEvent: 'dicom-send' | 'nifti-send',
    files: DicomSendFileEntry[]
  ): Promise<Response | null> {
    const topic = this._client.getSessionConfig().topic?.trim() ?? '';
    if (!topic) {
      throw new Error('Cast topic is not configured');
    }
    return this.castPublish({
      event: {
        'hub.topic': topic,
        'hub.event': hubEvent,
        context: { files },
      },
    });
  }

  private _registerMessageHandlers(): void {
    this._client.onMessage((message: CastMessage) => {
      const event = message?.event;
      if (!event) {
        return;
      }
      const hubEvent = getHubEventLower(event);

      if (isRequestEvent(hubEvent)) {
        Promise.resolve(this._handleGetRequest(message, event)).catch(error => {
          console.error(`${LOG_PREFIX} request handler failed for "${hubEvent}"`, error);
        });
        return;
      }

      if (hubEvent === 'imagingstudy-open') {
        void this._handleImagingStudyOpen(message);
        return;
      }
      if (hubEvent === 'imagingstudy-close') {
        this._imagingStudyHandler.handleClose();
        return;
      }
      if (hubEvent === 'dicom-send') {
        void this._handleBinaryEvent(message, 'dicom-send');
        return;
      }
      if (hubEvent === 'nifti-send') {
        void this._handleBinaryEvent(message, 'nifti-send');
        return;
      }
      if (hubEvent === 'status-update') {
        const context = event.context;
        const raw =
          context && typeof context === 'object' && !Array.isArray(context)
            ? (context as { message?: unknown }).message
            : undefined;
        if (typeof raw === 'string') {
          this.appendTotalSegmentatorJobStatusLine(raw);
          this._broadcastCastStatus();
        }
        return;
      }
      if (hubEvent === 'conference-start') {
        const context = event.context;
        const title =
          context && typeof context === 'object' && !Array.isArray(context)
            ? String((context as { title?: unknown }).title ?? '').trim()
            : '';
        const participants = normalizeConferenceParticipants(
          context && typeof context === 'object' && !Array.isArray(context)
            ? (context as { participants?: unknown }).participants
            : undefined
        );
        this._setConferenceActive(true, title, participants);
        void this._syncConferenceActive();
        return;
      }
      if (hubEvent === 'conference-end') {
        const context = event.context;
        const leaveTopic =
          context && typeof context === 'object' && !Array.isArray(context)
            ? String((context as { leaveTopic?: unknown }).leaveTopic ?? '').trim()
            : '';
        const sessionTopic =
          this._client.getSessionConfig().topic?.trim() ?? '';
        if (!leaveTopic || !sessionTopic || leaveTopic === sessionTopic) {
          this._setConferenceActive(false);
        }
        void this._syncConferenceActive();
        return;
      }
      if (hubEvent === 'annotation-update' || hubEvent === 'annotation-delete') {
        handleAnnotationEvent(message, this._servicesManager);
      }
    });
  }

  private async _handleImagingStudyOpen(message: CastMessage): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    const loadPromise = this._loadImagingStudyOpen(message);
    showImagingStudyOpenLoadingNotification(this._servicesManager, loadPromise);
    loadPromise.catch(err => {
      console.error(`${LOG_PREFIX} imagingstudy-open failed`, err);
    });
  }

  private async _loadImagingStudyOpen(
    message: CastMessage
  ): Promise<ImagingStudyOpenResult | null> {
    const resolved = await resolveCastFileMessage(this._client, message);
    const event = resolved?.event;
    if (!event) {
      return null;
    }
    await this._imagingStudyHandler.handleOpen(event, resolved);
    tryApplyPendingUsAnnotations(this._servicesManager);
    return { event, message: resolved };
  }

  private async _handleBinaryEvent(
    message: CastMessage,
    kind: 'dicom-send' | 'nifti-send'
  ): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const resolved = await resolveCastFileMessage(this._client, message);
      if (kind === 'dicom-send') {
        await handleDicomSendMessage(resolved, {
          scheduleCastDicomSendLayer: meta => this._scheduleCastDicomSendLayer(meta),
        });
      } else {
        await handleNiftiSendMessage(resolved);
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} ${kind} payload fetch failed`, err);
    }
  }

  private _handleGetRequest(message: CastMessage, event: CastMessage['event']): void {
    if (!this._client.sendCastRequestResponse || !event) {
      return;
    }

    const context =
      event.context && typeof event.context === 'object'
        ? (event.context as Record<string, unknown>)
        : {};
    const correlationId = context.id;
    if (typeof correlationId !== 'string' || !correlationId) {
      return;
    }

    if (isStatusRequestDataType(context.dataType)) {
      const statusPayload = buildStatusResponsePayload(
        this._productName,
        this._servicesManager
      );
      this._client.sendCastRequestResponse(
        correlationId,
        'STATUS',
        statusPayload,
        typeof event['hub.topic'] === 'string' ? event['hub.topic'] : undefined
      );
      console.info(`${LOG_PREFIX} status-response`, {
        id: correlationId,
        viewportCount: statusPayload.sceneview.viewports.length,
      });
      return;
    }

    const targetKeyword = getInboundTargetActorKeyword(message);
    if (
      targetKeyword &&
      targetKeyword !== '*' &&
      targetKeyword !== ID_ACTOR_KEYWORD
    ) {
      return;
    }

    const dataType = normalizeGetRequestDataType(context.dataType);
    if (!dataType) {
      return;
    }

    const image = buildGetRequestImagePayload(dataType);
    if (!image?.data) {
      return;
    }

    this._client.sendCastRequestResponse(
      correlationId,
      typeof context.dataType === 'string' ? context.dataType : dataType,
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
      typeof event['hub.topic'] === 'string' ? event['hub.topic'] : undefined
    );
  }

  private async _requestStatus(): Promise<void> {
    const subscriber = this._client.getSessionConfig().subscriberName?.trim() ?? '';
    if (!subscriber) {
      return;
    }

    try {
      const topic = this._client.getSessionConfig().topic?.trim() ?? '';
      const statusDataType = 'STATUS';
      const result = await this._client.request({
        'subscriber.name': subscriber,
        'subscriber.product.name': this._productName,
        event: {
          'hub.event': requestEventFor(statusDataType),
          ...(topic ? { 'hub.topic': topic } : {}),
          context: { dataType: statusDataType },
        },
        'subscriber.actor': ID_ACTOR_KEYWORD,
        'target.actor': '*',
      });

      if (!result.ok) {
        console.warn(`${LOG_PREFIX} STATUS request failed`, result.status);
        return;
      }

      const envelope =
        (result.data && typeof result.data === 'object'
          ? (result.data as CastRequestEnvelope)
          : undefined) ?? {};
      const responses = Array.isArray(envelope.responses) ? envelope.responses : [];
      const available = totalSegmentatorAvailableFromStatusResponses(responses);
      this.setTotalSegmentatorAvailable(available);
      this._broadcastCastStatus();

      let chosenData: unknown;
      for (const item of responses) {
        const actor = String(item?.actor ?? '').trim().toUpperCase();
        const itemData = item?.data;
        if (
          itemData &&
          typeof itemData === 'object' &&
          (itemData as { 'context.type'?: unknown })['context.type'] ===
            'ImagingStudy' &&
          (actor === 'WORKLIST_CLIENT' || chosenData === undefined)
        ) {
          chosenData = itemData;
          if (actor === 'WORKLIST_CLIENT') {
            break;
          }
        }
      }
      if (chosenData !== undefined) {
        await this._openStudyFromContextData(chosenData);
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} failed to request STATUS`, err);
    }
  }

  private async _openStudyFromContextData(data: unknown): Promise<void> {
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
    await this._imagingStudyHandler.handleOpen({
      context: typedData.context,
    });
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
      // ignore
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
      if (!url.searchParams.has('topic') && !url.searchParams.has('id-token')) {
        return;
      }
      url.searchParams.delete('topic');
      url.searchParams.delete('id-token');
      window.history.replaceState(null, '', url.toString());
    };

    const searchParams =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const fromUrl = searchParams?.get('topic')?.trim() ?? '';
    const idTokenParam = searchParams?.get('id-token')?.trim() ?? '';
    if (idTokenParam && idTokenParam.split('.').length >= 3) {
      this._urlHubAccessToken = idTokenParam;
    }
    if (fromUrl) {
      stripCastParamsFromUrl();
      return { topic: fromUrl, preserveSessionTopicFromToken: true };
    }

    const fromIdToken = idTokenParam ? decodeTopicFromJwt(idTokenParam) : '';
    if (fromIdToken || this._urlHubAccessToken) {
      stripCastParamsFromUrl();
      return {
        topic: fromIdToken || this._readStoredTopic() || configTopic?.trim() || '',
        preserveSessionTopicFromToken: true,
      };
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
    const urlToken = this._urlHubAccessToken.trim();
    if (urlToken && typeof this._client.setToken === 'function') {
      this._client.setToken(urlToken);
    } else {
      const tokenOk = await this.getToken();
      if (!tokenOk) {
        return;
      }
    }
    await this.castSubscribe();
    const topicAfterStart = this._client.getSessionConfig().topic?.trim() ?? '';
    if (topicAfterStart) {
      this._writeStoredTopic(topicAfterStart);
    }
  }

  private _broadcastCastStatus(wsState?: string): void {
    if (wsState !== undefined) {
      this._wsState = wsState;
    }
    const next = this.getCastHeaderStatus();
    if (
      this._lastBroadcastHeaderStatus &&
      castHeaderStatusEqual(this._lastBroadcastHeaderStatus, next)
    ) {
      return;
    }
    this._lastBroadcastHeaderStatus = next;
    this._broadcastEvent(CastService.EVENTS.STATUS_CHANGED, next);
  }

  private _setConferenceActive(
    active: boolean,
    title = '',
    participants?: string[]
  ): void {
    this._conferenceActive = active;
    if (!active) {
      this._conferenceTitle = '';
      this._conferenceParticipants = [];
      this._broadcastCastStatus();
      return;
    }
    this._conferenceTitle = title.trim();
    if (participants !== undefined) {
      this._conferenceParticipants = participants;
    }
    this._broadcastCastStatus();
  }

  private _stopConferencePoll(): void {
    if (this._conferencePollTimer != null) {
      clearInterval(this._conferencePollTimer);
      this._conferencePollTimer = null;
    }
  }

  private async _syncConferenceActive(): Promise<void> {
    const hubEndpoint = this._client.getHubConfig().hub_endpoint ?? '';
    const session = this._client.getSessionConfig();
    if (!hubEndpoint || this._wsState !== 'connected') {
      this._setConferenceActive(false);
      return;
    }
    const { active, title, participants } = await resolveCastConferenceState(
      hubEndpoint,
      session.topic?.trim() ?? '',
      this._subscriberName.trim() || session.subscriberName?.trim() || ''
    );
    this._setConferenceActive(active, title, participants);
  }

  private _startConferencePoll(): void {
    this._stopConferencePoll();
    void this._syncConferenceActive();
    this._conferencePollTimer = setInterval(() => {
      void this._syncConferenceActive();
    }, CAST_CONFERENCE_POLL_MS);
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
    const tryAdd = () => {
      if (done || attempt++ > maxAttempts) {
        return;
      }
      done = this._addCastDicomSendAsLayer(meta);
      if (!done) {
        window.setTimeout(tryAdd, 300);
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

    const { displaySetService, viewportGridService, cornerstoneViewportService } =
      this._servicesManager.services;
    const viewportId = this._resolveCastLayerViewportId();
    if (!viewportId) {
      return false;
    }

    if (!cornerstoneViewportService?.getViewportInfo(viewportId)) {
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

    try {
      this._commandsManager.runCommand('addDisplaySetAsLayer', {
        viewportId,
        displaySetInstanceUID: uid,
      });
    } catch (err) {
      console.warn(`${LOG_PREFIX} addDisplaySetAsLayer failed`, err);
      return false;
    }
    return true;
  }
}
