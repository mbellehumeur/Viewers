export interface CastHeaderStatusState {
  topic: string;
  hubLabel: string;
  subscriberName: string;
  statusText: string;
  wsState: string;
  totalSegmentatorAvailable: boolean;
  totalSegmentatorJobStatus: string;
  conferenceActive: boolean;
  conferenceTitle: string;
}

export function castStatusTextForWsState(wsState?: string): string {
  return wsState === 'connected'
    ? 'connected'
    : wsState === 'connecting'
      ? 'Websocket connecting'
      : wsState === 'error'
        ? 'Websocket error'
        : wsState === 'disconnected'
          ? 'Websocket disconnected'
          : 'Ready';
}

export function buildCastHeaderStatus(
  topic: string,
  hubLabel: string,
  subscriberName: string,
  wsState: string,
  totalSegmentatorAvailable = false,
  totalSegmentatorJobStatus = '',
  conferenceActive = false,
  conferenceTitle = ''
): CastHeaderStatusState {
  const trimmedTopic = topic.trim();
  const label = hubLabel.trim() || 'Hub';
  const subscriber = subscriberName.trim();
  const statusText =
    wsState === 'connected' ? subscriber : castStatusTextForWsState(wsState);

  return {
    topic: trimmedTopic,
    hubLabel: label,
    subscriberName: subscriber,
    statusText,
    wsState,
    totalSegmentatorAvailable,
    totalSegmentatorJobStatus,
    conferenceActive,
    conferenceTitle: conferenceActive ? conferenceTitle.trim() : '',
  };
}

export function castHeaderStatusEqual(
  a: CastHeaderStatusState,
  b: CastHeaderStatusState
): boolean {
  return (
    a.topic === b.topic &&
    a.hubLabel === b.hubLabel &&
    a.subscriberName === b.subscriberName &&
    a.statusText === b.statusText &&
    a.wsState === b.wsState &&
    a.totalSegmentatorAvailable === b.totalSegmentatorAvailable &&
    a.totalSegmentatorJobStatus === b.totalSegmentatorJobStatus &&
    a.conferenceActive === b.conferenceActive &&
    a.conferenceTitle === b.conferenceTitle
  );
}
