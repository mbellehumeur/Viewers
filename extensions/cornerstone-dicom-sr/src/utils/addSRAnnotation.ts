import { Types, annotation } from '@cornerstonejs/tools';
import { metaData } from '@cornerstonejs/core';
import { adaptersSR } from '@cornerstonejs/adapters';

import getRenderableData from './getRenderableData';
import toolNames from '../tools/toolNames';

const { MeasurementReport } = adaptersSR.Cornerstone3D;

export default function addSRAnnotation(measurement, srDisplaySet) {
  let toolName = toolNames.DICOMSRDisplay; //  this would need to handle the format as well
  toolName = toolNames.SRSCOORD3DPoint;
  const renderableData = measurement.coords.reduce((acc, coordProps) => {
    acc[coordProps.GraphicType] = acc[coordProps.GraphicType] || [];
    acc[coordProps.GraphicType].push(getRenderableData({ ...coordProps }));
    return acc;
  }, {});

  const { TrackingUniqueIdentifier } = measurement;
  const { ValueType: valueType, GraphicType: graphicType } = measurement.coords[0];
  const graphicTypePoints = renderableData[graphicType];

  if (valueType === 'SCOORD3D') {
    const adapter = MeasurementReport.getAdapterForTrackingIdentifier(
      measurement.TrackingIdentifier
    );
    // Use SRCOORD3DPoint tool for SCOORD3D POINT measurements
    if (graphicType === 'POINT') {
      toolName = toolNames.SRSCOORD3DPoint;
    } else if (!adapter) {
      toolName = toolNames.SRArrowAnnotate;
    }
  }

  // Create annotation directly without using generateToolState for SCOORD3D
  if (
    (valueType === 'SCOORD3D' && toolName === toolNames.SRSCOORD3DPoint) ||
    toolName === toolNames.SRArrowAnnotate
  ) {
    const coord = measurement.coords[0];
    const { GraphicData } = coord;

    // For SCOORD3D POINT, create arrow annotation data
    if (graphicType === 'POINT' && GraphicData?.length >= 3) {
      const [x, y, z] = GraphicData;

      const SRAnnotation: Types.Annotation = {
        annotationUID: TrackingUniqueIdentifier,
        highlighted: false,
        isLocked: false,
        invalidated: false,
        metadata: {
          toolName,
          FrameOfReferenceUID: measurement.FrameOfReferenceUID,
          // For SCOORD3D measurements, don't set referencedImageId since they're 3D world coordinates
          // referencedImageId: imageId, // This causes "Unable to apply reference viewable" warnings
        },
        data: {
          text: measurement.TrackingIdentifier || 'SR Point',
          handles: {
            points: [
              [x, y, z], // Start point
              [x + 10, y, z + 10], // End point (arrow direction)
            ],
            activeHandleIndex: null,
            // textBox: {
            //   hasMoved: false,
            //   worldPosition: [x + 5, y + 5, z + 5],
            //   worldBoundingBox: {
            //     topLeft: [x - 5, y - 5, z - 5],
            //     topRight: [x + 15, y - 5, z - 5],
            //     bottomLeft: [x - 5, y + 15, z - 5],
            //     bottomRight: [x + 15, y + 15, z - 5],
            //   },
            // },
          },
          label: measurement.TrackingIdentifier || 'SR Annotation',
          labelText: measurement.labels?.map(l => `${l.label}: ${l.value}`).join('\n') || '',
          cachedStats: {},
          frameNumber: null, // SCOORD3D measurements don't have frame numbers
          renderableData,
          TrackingUniqueIdentifier,
          labels: measurement.labels,
          // Mark this as a 3D world coordinate measurement
          is3DMeasurement: true,
        },
      };

      annotation.state.addAnnotation(SRAnnotation, measurement.FrameOfReferenceUID);
      return;
    }
  }

  // Fallback to original logic for other cases
  const SRAnnotation: Types.Annotation = {
    annotationUID: TrackingUniqueIdentifier,
    highlighted: false,
    isLocked: false,
    invalidated: false,
    metadata: {
      toolName,
      FrameOfReferenceUID: frameOfReferenceUID,
      referencedImageId: imageId,
    },
    data: {
      label: measurement.labels?.[0]?.value || undefined,
      displayText: measurement.displayText || undefined,
      handles: {
        textBox: measurement.textBox ?? {},
        points: graphicTypePoints[0],
      },
      cachedStats: {},
      frameNumber,
      renderableData,
      TrackingUniqueIdentifier,
      labels: measurement.labels,
    },
  };

  /**
   * const annotationManager = annotation.annotationState.getAnnotationManager();
   * was not triggering annotation_added events.
   */
  annotation.state.addAnnotation(SRAnnotation, frameOfReferenceUID);
  // In addSRAnnotation function (utils/addSRAnnotation.ts)
  console.debug('DEBUG addSRAnnotation: Adding annotation', {
    tool: measurement.tool,
    TrackingUniqueIdentifier: measurement.TrackingUniqueIdentifier,
    is3DMeasurement: measurement.is3DMeasurement,
    points: measurement.points,
    coords: measurement.coords,
  });
}
