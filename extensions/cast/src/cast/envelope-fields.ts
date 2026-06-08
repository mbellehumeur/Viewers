import type { CastMessage } from '@kitware/vtk.js/Sources/IO/Core/CastClient';
import { ID_ACTOR_KEYWORD } from './types';

export const CAST_ENVELOPE_ANY = '*';

export const CAST_DEFAULT_SUBSCRIBER_ACTOR = ID_ACTOR_KEYWORD;

export type CastPublishEnvelopeFields = {
  subscriberName: string;
  subscriberActor: string;
  targetActor: string;
  targetProductName: string;
};

export const DEFAULT_CAST_PUBLISH_ENVELOPE_FIELDS: CastPublishEnvelopeFields = {
  subscriberName: CAST_ENVELOPE_ANY,
  subscriberActor: CAST_DEFAULT_SUBSCRIBER_ACTOR,
  targetActor: CAST_ENVELOPE_ANY,
  targetProductName: CAST_ENVELOPE_ANY,
};

export function normalizeOptionalEnvelopeField(
  value: string | undefined | null
): string {
  const text = String(value ?? '').trim();
  return text || CAST_ENVELOPE_ANY;
}

export function resolveCastPublishEnvelopeFields(
  fields: Partial<CastPublishEnvelopeFields>,
  defaults: { subscriberName: string }
): CastPublishEnvelopeFields {
  const name = (fields.subscriberName ?? '').trim();
  return {
    subscriberName: name || defaults.subscriberName || CAST_ENVELOPE_ANY,
    subscriberActor:
      (fields.subscriberActor ?? '').trim() || CAST_DEFAULT_SUBSCRIBER_ACTOR,
    targetActor: normalizeOptionalEnvelopeField(fields.targetActor),
    targetProductName: normalizeOptionalEnvelopeField(fields.targetProductName),
  };
}

export function applyCastPublishEnvelopeFields(
  message: CastMessage,
  fields: CastPublishEnvelopeFields
): void {
  message['subscriber.name'] =
    fields.subscriberName.trim() || CAST_ENVELOPE_ANY;
  message['subscriber.actor'] =
    fields.subscriberActor.trim() || CAST_DEFAULT_SUBSCRIBER_ACTOR;
  message['target.actor'] = normalizeOptionalEnvelopeField(fields.targetActor);
  message['target.product.name'] = normalizeOptionalEnvelopeField(
    fields.targetProductName
  );
}
