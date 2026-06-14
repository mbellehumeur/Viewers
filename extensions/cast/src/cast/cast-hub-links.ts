export function httpUrlFromHubEndpoint(hubEndpoint: string): URL | null {
  const trimmed = hubEndpoint.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'ws:') {
      url.protocol = 'http:';
    } else if (url.protocol === 'wss:') {
      url.protocol = 'https:';
    }
    return url;
  } catch {
    return null;
  }
}

export function resolveCastHubAdminUrl(hubEndpoint: string): string {
  const url = httpUrlFromHubEndpoint(hubEndpoint);
  if (!url) {
    return '';
  }
  const hubBase = url.href.endsWith('/') ? url.href : `${url.href}/`;
  return new URL('admin', hubBase).href;
}

export function resolveCastConferenceClientUrl(
  hubEndpoint: string,
  opts?: { topic?: string; subscriberName?: string; theme?: string; mode?: string }
): string {
  const url = httpUrlFromHubEndpoint(hubEndpoint);
  if (!url) {
    return '';
  }
  const conferenceUrl = new URL('/api/hub/conference-client', url.origin);
  const subscriberName = opts?.subscriberName?.trim();
  const topic = opts?.topic?.trim();
  const theme = opts?.theme?.trim() || 'volview';
  const mode = opts?.mode?.trim().toLowerCase() === 'light' ? 'light' : 'dark';
  if (subscriberName) {
    conferenceUrl.searchParams.set('subscriberName', subscriberName);
  }
  if (topic) {
    conferenceUrl.searchParams.set('topic', topic);
  }
  conferenceUrl.searchParams.set('theme', theme);
  conferenceUrl.searchParams.set('mode', mode);
  return conferenceUrl.href;
}

export const CAST_CONFERENCE_POPUP_SIZE = { width: 336, height: 288 };

export function openCastHubPopup(
  url: string,
  windowName: string,
  size: { width: number; height: number } = { width: 800, height: 600 }
): void {
  if (!url) {
    return;
  }
  const popupWidth = size.width;
  const popupHeight = size.height;
  const left = Math.max(0, Math.floor((window.screen.width - popupWidth) / 2));
  const top = Math.max(0, Math.floor((window.screen.height - popupHeight) / 2));
  const features = [
    'popup',
    `width=${popupWidth}`,
    `height=${popupHeight}`,
    `left=${left}`,
    `top=${top}`,
    'noopener',
    'noreferrer',
  ].join(',');
  window.open(url, windowName, features);
}
