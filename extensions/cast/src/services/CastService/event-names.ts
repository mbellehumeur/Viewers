// Shared helpers for Cast hub.event names (OHIF Cast extension).
//
// Per-dataType events: '<dataType.lower()>-request' / '-response'.
// isRequestEvent / isResponseEvent use the suffixes only.
//
// Keep this mapping in sync with:
// - VolView/server/cast_api/cast_client.py
// - vtk-js/Sources/IO/Core/CastClient/eventNames.js
// - VolView/src/io/cast/event-names.ts

export const REQUEST_SUFFIX = '-request';
export const RESPONSE_SUFFIX = '-response';

export function normalizeDataType(dataType: unknown): string {
  if (typeof dataType !== 'string') {
    return '';
  }
  return dataType.trim().toLowerCase();
}

export function requestEventFor(dataType: unknown): string {
  const base = normalizeDataType(dataType);
  if (!base) {
    return '';
  }
  return `${base}${REQUEST_SUFFIX}`;
}

export function responseEventFor(dataType: unknown): string {
  const base = normalizeDataType(dataType);
  if (!base) {
    return '';
  }
  return `${base}${RESPONSE_SUFFIX}`;
}

export function isRequestEvent(name: unknown): boolean {
  if (typeof name !== 'string') {
    return false;
  }
  return name.endsWith(REQUEST_SUFFIX);
}

export function isResponseEvent(name: unknown): boolean {
  if (typeof name !== 'string') {
    return false;
  }
  return name.endsWith(RESPONSE_SUFFIX);
}

export function dataTypeFromEventName(name: unknown): string {
  if (typeof name !== 'string') {
    return '';
  }
  if (name.endsWith(REQUEST_SUFFIX)) {
    return name.slice(0, -REQUEST_SUFFIX.length);
  }
  if (name.endsWith(RESPONSE_SUFFIX)) {
    return name.slice(0, -RESPONSE_SUFFIX.length);
  }
  return '';
}
