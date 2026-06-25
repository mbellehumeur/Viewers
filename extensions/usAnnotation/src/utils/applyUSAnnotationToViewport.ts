import {
  UltrasoundPleuraBLineTool,
  annotation,
} from '@cornerstonejs/tools';
import { utilities } from '@cornerstonejs/core';
import type { FrameAnnotation, Point3D, RatedLine } from './usAnnotationJson';
import { normalizeRaterName, raterMatches } from './usAnnotationJson';
import { slicerPointsToWorld } from './usAnnotationCoordinates';

const { uuidv4 } = utilities;

type ApplyOptions = {
  rater?: string;
  clearExisting?: boolean;
};

function createAnnotation(
  viewport: AppTypes.ICornerstoneViewport,
  referencedImageId: string,
  annotationType: string,
  worldPoints: [Point3D, Point3D],
  rater: string
) {
  const [point1, point2] = worldPoints;
  const viewReference = viewport.getViewReference({ points: [point1] });
  const { viewUp, position: cameraPosition } = viewport.getCamera();

  return {
    annotationUID: uuidv4(),
    highlighted: false,
    invalidated: true,
    isLocked: false,
    isVisible: true,
    metadata: {
      ...viewReference,
      toolName: UltrasoundPleuraBLineTool.toolName,
      referencedImageId,
      viewUp,
      cameraPosition,
      rater: normalizeRaterName(rater),
    },
    data: {
      handles: {
        points: [point1, point2],
        activeHandleIndex: null,
      },
      annotationType,
      label: '',
    },
  };
}

/**
 * Hydrates parsed frame annotations as live UltrasoundPleuraBLineTool annotations
 * on the viewport, which populates the OHIF measurement table via the standard bridge.
 */
export function applyUSAnnotationToViewport(
  viewport: AppTypes.ICornerstoneViewport,
  frameAnnotations: FrameAnnotation[],
  options: ApplyOptions = {}
): { added: number; skipped: number } {
  const { rater, clearExisting = true } = options;
  const { element } = viewport;

  if (clearExisting) {
    UltrasoundPleuraBLineTool.deleteAnnotations(element, () => true);
  }

  if (!rater) {
    viewport.render();
    return { added: 0, skipped: 0 };
  }

  const viewportImageIds = viewport.getImageIds();
  let added = 0;
  let skipped = 0;

  frameAnnotations.forEach(frame => {
    const referencedImageId = viewportImageIds[frame.frame_number];
    if (!referencedImageId) {
      skipped +=
        frame.pleura_lines.filter(line => raterMatches(line.rater, rater)).length +
        frame.b_lines.filter(line => raterMatches(line.rater, rater)).length;
      return;
    }

    const addLine = (line: RatedLine, annotationType: string) => {
      if (!raterMatches(line.rater, rater)) {
        skipped++;
        return;
      }

      const points = line.line.points;
      if (!points || points.length < 2) {
        skipped++;
        return;
      }

      try {
        const worldPoints = slicerPointsToWorld(points, frame.coordinate_space);
        const newAnnotation = createAnnotation(
          viewport,
          referencedImageId,
          annotationType,
          worldPoints,
          line.rater || rater
        );

        annotation.state.addAnnotation(newAnnotation, element);
        annotation.state.triggerAnnotationCompleted(newAnnotation);
        added++;
      } catch {
        skipped++;
      }
    };

    frame.pleura_lines.forEach(line =>
      addLine(line, UltrasoundPleuraBLineTool.USPleuraBLineAnnotationType.PLEURA)
    );
    frame.b_lines.forEach(line =>
      addLine(line, UltrasoundPleuraBLineTool.USPleuraBLineAnnotationType.BLINE)
    );
  });

  viewport.render();

  return { added, skipped };
}
