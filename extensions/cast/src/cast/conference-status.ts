import { httpUrlFromHubEndpoint } from './cast-hub-links';

export const CAST_CONFERENCE_POLL_MS = 30_000;

export type CastConferenceRecord = {
  user?: string;
  title?: string;
  topics?: string[];
};

export function isCastConferenceParticipant(
  topic: string,
  subscriberName: string,
  conference: CastConferenceRecord
): boolean {
  const normalizedTopic = topic.trim();
  const normalizedSubscriber = subscriberName.trim();
  const host = String(conference.user ?? '').trim();
  const attendeeTopics = Array.isArray(conference.topics)
    ? conference.topics.map((value) => String(value).trim()).filter(Boolean)
    : [];

  if (normalizedTopic) {
    if (normalizedTopic === host) {
      return true;
    }
    if (attendeeTopics.includes(normalizedTopic)) {
      return true;
    }
  }
  if (normalizedSubscriber && normalizedSubscriber === host) {
    return true;
  }
  return false;
}

export function findActiveCastConference(
  topic: string,
  subscriberName: string,
  conferences: CastConferenceRecord[]
): CastConferenceRecord | null {
  for (const conference of conferences) {
    if (isCastConferenceParticipant(topic, subscriberName, conference)) {
      return conference;
    }
  }
  return null;
}

export async function fetchCastConferences(
  hubEndpoint: string
): Promise<CastConferenceRecord[]> {
  const url = httpUrlFromHubEndpoint(hubEndpoint);
  if (!url) {
    return [];
  }
  const apiUrl = new URL('/api/hub/conference', url.origin).href;
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function resolveCastConferenceState(
  hubEndpoint: string,
  topic: string,
  subscriberName: string
): Promise<{ active: boolean; title: string }> {
  const conferences = await fetchCastConferences(hubEndpoint);
  const match = findActiveCastConference(topic, subscriberName, conferences);
  return {
    active: Boolean(match),
    title: String(match?.title ?? '').trim(),
  };
}
