import { UltrasoundPleuraBLineTool } from '@cornerstonejs/tools';
import type { FrameAnnotation, Point3D } from './usAnnotationJson';
import { normalizeRaterName, raterMatches } from './usAnnotationJson';
import { worldPointToSlicerLps } from './usAnnotationCoordinates';

/**
 * Replaces the selected rater's lines in merged frames with live viewport annotations.
 */
export function syncViewportToMergedFrames(
  viewport: AppTypes.ICornerstoneViewport,
  mergedFrames: FrameAnnotation[],
  rater: string,
  imageIds: string[] = []
): FrameAnnotation[] {
  const normalizedRater = normalizeRaterName(rater);
  if (!normalizedRater) {
    return mergedFrames;
  }

  const filterImageIds = (imageId: string) => {
    if (imageIds.length === 0) {
      return true;
    }
    return imageIds.includes(imageId);
  };

  const annotations = UltrasoundPleuraBLineTool.filterAnnotations(
    viewport.element,
    filterImageIds
  );
  const viewportImageIds = viewport.getImageIds();

  const liveByFrame = new Map<
    number,
    { pleura_lines: Point3D[][]; b_lines: Point3D[][]; coordinate_space: FrameAnnotation['coordinate_space'] }
  >();

  annotations.forEach(annotation => {
    const referencedImageId = annotation.metadata.referencedImageId;
    const frameNumber = viewportImageIds.indexOf(referencedImageId);
    if (frameNumber < 0) {
      return;
    }

    if (!liveByFrame.has(frameNumber)) {
      liveByFrame.set(frameNumber, {
        pleura_lines: [],
        b_lines: [],
        coordinate_space: 'LPS',
      });
    }

    const frameEntry = liveByFrame.get(frameNumber);
    const [point1, point2] = annotation.data.handles.points;
    const points: Point3D[] = [worldPointToSlicerLps(point1), worldPointToSlicerLps(point2)];
    const { annotationType } = annotation.data;

    if (annotationType === UltrasoundPleuraBLineTool.USPleuraBLineAnnotationType.PLEURA) {
      frameEntry.pleura_lines.push(points);
    } else if (annotationType === UltrasoundPleuraBLineTool.USPleuraBLineAnnotationType.BLINE) {
      frameEntry.b_lines.push(points);
    }
  });

  const byFrame = new Map<number, FrameAnnotation>();
  mergedFrames.forEach(frame => {
    byFrame.set(frame.frame_number, {
      ...frame,
      pleura_lines: frame.pleura_lines.filter(line => !raterMatches(line.rater, normalizedRater)),
      b_lines: frame.b_lines.filter(line => !raterMatches(line.rater, normalizedRater)),
    });
  });

  liveByFrame.forEach((liveFrame, frameNumber) => {
    let frame = byFrame.get(frameNumber);
    if (!frame) {
      frame = {
        frame_number: frameNumber,
        coordinate_space: liveFrame.coordinate_space,
        pleura_lines: [],
        b_lines: [],
      };
      byFrame.set(frameNumber, frame);
    }

    frame.pleura_lines.push(
      ...liveFrame.pleura_lines.map(points => ({
        rater: normalizedRater,
        line: { points },
      }))
    );
    frame.b_lines.push(
      ...liveFrame.b_lines.map(points => ({
        rater: normalizedRater,
        line: { points },
      }))
    );
  });

  return Array.from(byFrame.values()).sort((a, b) => a.frame_number - b.frame_number);
}
