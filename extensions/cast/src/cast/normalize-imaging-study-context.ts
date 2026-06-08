type FhirContextItem = {
  key?: string;
  resource?: Record<string, unknown>;
};

/**
 * FHIRcast ImagingStudy-open context is normally an array of { key, resource }.
 * Some hubs send a plain object; normalize so vtk extractors work.
 */
export function normalizeImagingStudyContext(context: unknown): unknown {
  if (Array.isArray(context)) {
    return context;
  }
  if (!context || typeof context !== 'object') {
    return context;
  }

  const record = context as Record<string, unknown>;
  const items: FhirContextItem[] = [];

  for (const [key, value] of Object.entries(record)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    if (Array.isArray(value)) {
      continue;
    }
    items.push({
      key,
      resource: value as Record<string, unknown>,
    });
  }

  return items.length ? items : context;
}
