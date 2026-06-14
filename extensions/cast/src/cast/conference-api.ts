import { httpUrlFromHubEndpoint } from './cast-hub-links';

export const CAST_CONFERENCE_TITLE_PRESETS = [
  'Test conference',
  'US annotations',
  'Tumor Board',
  'Case discussion',
  'Pedicle screw',
] as const;

function conferenceApiUrl(hubEndpoint: string, path: string): string | null {
  const url = httpUrlFromHubEndpoint(hubEndpoint);
  if (!url) {
    return null;
  }
  return new URL(path, url.origin).href;
}

export async function fetchCastConferenceTopics(
  hubEndpoint: string
): Promise<string[]> {
  const apiUrl = conferenceApiUrl(hubEndpoint, '/api/hub/conference-topics');
  if (!apiUrl) {
    return [];
  }
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      return [];
    }
    return data
      .map((entry) => String(entry).trim())
      .filter((topic) => topic && topic !== '*');
  } catch {
    return [];
  }
}

export async function createCastConference(
  hubEndpoint: string,
  hostTopic: string,
  title: string,
  topics: string[]
): Promise<void> {
  const apiUrl = conferenceApiUrl(hubEndpoint, '/api/hub/conference');
  if (!apiUrl) {
    throw new Error('Invalid hub endpoint');
  }
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hostTopic: hostTopic.trim(),
      title: title.trim(),
      topics,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `HTTP ${response.status}`);
  }
}

export async function deleteCastConference(
  hubEndpoint: string,
  hostTopic: string,
  leaveTopic?: string
): Promise<void> {
  const apiUrl = conferenceApiUrl(hubEndpoint, '/api/hub/conference');
  if (!apiUrl) {
    throw new Error('Invalid hub endpoint');
  }
  const body: { hostTopic: string; leaveTopic?: string } = {
    hostTopic: hostTopic.trim(),
  };
  const leave = leaveTopic?.trim();
  if (leave) {
    body.leaveTopic = leave;
  }
  const response = await fetch(apiUrl, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `HTTP ${response.status}`);
  }
}
