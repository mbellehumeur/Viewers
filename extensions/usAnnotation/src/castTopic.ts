const CAST_TOPIC_SESSION_KEY = 'ohif.cast.sessionTopic';
const CAST_STATUS_CHANGED_EVENT = 'event::CastService:statusChanged';

type CastServiceLike = {
  getCastHeaderStatus?: () => { topic?: string };
  getSessionConfig?: () => { topic?: string };
  subscribe?: (event: string, callback: () => void) => { unsubscribe: () => void };
};

export function readStoredCastTopic(): string {
  try {
    return window.sessionStorage.getItem(CAST_TOPIC_SESSION_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function resolveCastTopic(castService?: CastServiceLike): string {
  if (!castService) {
    return readStoredCastTopic();
  }
  const fromStatus = castService.getCastHeaderStatus?.()?.topic?.trim() ?? '';
  if (fromStatus) {
    return fromStatus;
  }
  const fromSession = castService.getSessionConfig?.()?.topic?.trim() ?? '';
  if (fromSession) {
    return fromSession;
  }
  return readStoredCastTopic();
}

export function subscribeCastTopic(
  castService: CastServiceLike | undefined,
  onTopic: (topic: string) => void
): () => void {
  const sync = () => onTopic(resolveCastTopic(castService));
  sync();
  if (!castService?.subscribe) {
    return () => {};
  }
  const { unsubscribe } = castService.subscribe(CAST_STATUS_CHANGED_EVENT, sync);
  return unsubscribe;
}
