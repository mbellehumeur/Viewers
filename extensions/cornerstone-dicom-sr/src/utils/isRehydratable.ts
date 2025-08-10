import { adaptersSR } from '@cornerstonejs/adapters';

const { MeasurementReport } = adaptersSR.Cornerstone3D;

/**
 * Checks if the given `displaySet`can be rehydrated into the `measurementService`.
 *
 * @param {object} displaySet The SR `displaySet` to check.
 * @param {object[]} mappings The CornerstoneTools 4 mappings to the `measurementService`.
 * @returns {boolean} True if the SR can be rehydrated into the `measurementService`.
 */
export default function isRehydratable(displaySet, mappings) {
  if (!mappings || !mappings.length) {
    return false;
  }

  const mappingDefinitions = new Set<string>();
  for (const m of mappings) {
    mappingDefinitions.add(m.annotationType);
  }

  const { measurements } = displaySet;

  for (let i = 0; i < measurements.length; i++) {
    const measurement = measurements[i];
    if (!measurement) {
      continue;
    }

    const {
      TrackingIdentifier = '',
      graphicType,
      graphicCode,
      pointsLength,
      is3DMeasurement,
      coords,
    } = measurement;

    // For SCOORD3D measurements, check if ArrowAnnotate is available
    if (is3DMeasurement || coords?.[0]?.ValueType === 'SCOORD3D') {
      // For SCOORD3D POINT measurements, ensure we're treating it as a single measurement
      if (coords?.[0]?.GraphicType === 'POINT' && pointsLength === 1) {
        if (mappingDefinitions.has('ArrowAnnotate')) {
          console.log(
            'SCOORD3D POINT measurement can be rehydrated as ArrowAnnotate',
            TrackingIdentifier
          );
          return true;
        }
      }
    }

    if (!TrackingIdentifier && !graphicType) {
      console.warn('No tracking identifier or graphicType for measurement ', measurement);
      continue;
    }

    const adapter = MeasurementReport.getAdapterForTrackingIdentifier(TrackingIdentifier);
    const adapters = MeasurementReport.getAdaptersForTypes(graphicCode, graphicType, pointsLength);
    const hydratable =
      (adapter && mappingDefinitions.has(adapter.toolType)) ||
      (adapters && adapters.some(adapter => mappingDefinitions.has(adapter.toolType)));

    if (hydratable) {
      return true;
    }
    console.log('Measurement is not rehydratable', TrackingIdentifier, measurements[i]);
  }

  console.log('No measurements found which were rehydratable');
  return false;
}
