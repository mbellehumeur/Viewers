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
  opts?: { topic?: string; subscriberName?: string }
): string {
  const url = httpUrlFromHubEndpoint(hubEndpoint);
  if (!url) {
    return '';
  }
  const conferenceUrl = new URL('/api/hub/conference-client', url.origin);
  const subscriberName = opts?.subscriberName?.trim();
  const topic = opts?.topic?.trim();
  if (subscriberName) {
    conferenceUrl.searchParams.set('subscriberName', subscriberName);
  }
  if (topic) {
    conferenceUrl.searchParams.set('topic', topic);
  }
  return conferenceUrl.href;
}

export function openCastHubPopup(url: string, windowName: string): void {
  if (!url) {
    return;
  }
  const popupWidth = 800;
  const popupHeight = 600;
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
