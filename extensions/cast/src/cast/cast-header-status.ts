export interface CastHeaderStatusState {
  topic: string;
  hubLabel: string;
  subscriberName: string;
  statusText: string;
  wsState: string;
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
  wsState: string
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
    a.wsState === b.wsState
  );
}
