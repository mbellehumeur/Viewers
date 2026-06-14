import { httpUrlFromHubEndpoint } from './cast-hub-links';

export const CAST_CONFERENCE_POLL_MS = 30_000;

export const CAST_CONFERENCE_EXIT_ACK_MS = 1200;

export type CastConferenceRecord = {
  hostTopic?: string;
  /** Legacy host identifier (may be hub topic or subscriber name). */
  user?: string;
  title?: string;
  topics?: string[];
  participants?: string[];
};

export function normalizeConferenceParticipants(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const name = String(entry ?? '').trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

export function conferenceHostTopic(
  conference: CastConferenceRecord
): string {
  return String(conference.hostTopic ?? conference.user ?? '').trim();
}

export function isCastConferenceHost(
  topic: string,
  conference: CastConferenceRecord
): boolean {
  const host = conferenceHostTopic(conference);
  const normalizedTopic = topic.trim();
  if (!normalizedTopic || !host) {
    return false;
  }
  return (
    normalizedTopic === host ||
    normalizedTopic.toLowerCase() === host.toLowerCase()
  );
}

export function isCastConferenceParticipant(
  topic: string,
  subscriberName: string,
  conference: CastConferenceRecord
): boolean {
  const normalizedTopic = topic.trim();
  const normalizedSubscriber = subscriberName.trim();
  const host = conferenceHostTopic(conference);
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
): Promise<{ active: boolean; title: string; participants: string[] }> {
  const conferences = await fetchCastConferences(hubEndpoint);
  const match = findActiveCastConference(topic, subscriberName, conferences);
  return {
    active: Boolean(match),
    title: String(match?.title ?? '').trim(),
    participants: normalizeConferenceParticipants(match?.participants),
  };
}
