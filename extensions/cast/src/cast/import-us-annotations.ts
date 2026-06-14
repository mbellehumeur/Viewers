import { metaData, utilities } from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';
import {
  UltrasoundPleuraBLineTool,
  annotation,
  triggerAnnotationRenderForViewportIds,
} from '@cornerstonejs/tools';

import { LOG_PREFIX } from './constants';
import type { ServicesManagerLike } from './types';

const { transformIndexToWorld } = utilities;

const US_TOOL_NAME = UltrasoundPleuraBLineTool.toolName;
const PLEURA = UltrasoundPleuraBLineTool.USPleuraBLineAnnotationType.PLEURA;
const BLINE = UltrasoundPleuraBLineTool.USPleuraBLineAnnotationType.BLINE;

type FrameAnnotations = Record<
  string,
  {
    pleura_lines?: number[][][];
    b_lines?: number[][][];
  }
>;

type UsAnnotationsBody = {
  SOPInstanceUID?: string;
  mask_type?: string;
  angle1?: number;
  angle2?: number;
  center_rows_px?: number;
  center_cols_px?: number;
  radius1?: number;
  radius2?: number;
  AnnotationLabels?: string[];
  labels?: string[];
  rater?: string;
  frame_annotations?: FrameAnnotations;
};

export type UsAnnotationCastContext = {
  schemaVersion?: number;
  toolName?: string;
  studyInstanceUID?: string;
  seriesInstanceUID?: string;
  annotations?: UsAnnotationsBody;
};

let pendingAnnotationContext: UsAnnotationCastContext | null = null;

function asContext(value: unknown): UsAnnotationCastContext | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as UsAnnotationCastContext;
}

function resolveViewportForSeries(
  servicesManager: ServicesManagerLike,
  studyInstanceUID: string,
  seriesInstanceUID: string
): {
  viewportId: string;
  viewport: Types.IStackViewport;
  toolGroupService: {
    getToolGroupForViewport: (viewportId: string) => {
      setToolConfiguration: (toolName: string, config: Record<string, unknown>) => void;
    } | null;
  };
} | null {
  const services = servicesManager.services as AppTypes.Services;
  const { viewportGridService, cornerstoneViewportService, displaySetService, toolGroupService } =
    services;

  const candidates = displaySetService.getDisplaySetsForSeries(seriesInstanceUID);
  if (!candidates?.length) {
    return null;
  }

  const matchingDisplaySet =
    candidates.find(
      ds =>
        !studyInstanceUID ||
        !ds.StudyInstanceUID ||
        ds.StudyInstanceUID === studyInstanceUID
    ) ?? candidates[0];
  const targetUid = matchingDisplaySet?.displaySetInstanceUID;
  if (!targetUid) {
    return null;
  }

  const viewports = viewportGridService.getState()?.viewports;
  if (viewports?.size) {
    for (const [mapKey, vp] of viewports) {
      const viewportId = vp.viewportId ?? mapKey;
      const uids = viewportGridService.getDisplaySetsUIDsForViewport(viewportId) ?? [];
      if (!uids.includes(targetUid)) {
        continue;
      }
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (viewport) {
        return { viewportId, viewport, toolGroupService };
      }
    }
  }

  const activeViewportId = viewportGridService.getActiveViewportId();
  if (activeViewportId) {
    const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
    if (viewport) {
      return { viewportId: activeViewportId, viewport, toolGroupService };
    }
  }

  return null;
}

function clearUsAnnotations(element: HTMLElement): void {
  const existing = annotation.state.getAnnotations(US_TOOL_NAME, element);
  if (!existing?.length) {
    return;
  }
  for (const ann of existing) {
    annotation.state.removeAnnotation(ann.annotationUID);
  }
}

function applyFanConfiguration(
  toolGroupService: {
    getToolGroupForViewport: (viewportId: string) => {
      setToolConfiguration: (toolName: string, config: Record<string, unknown>) => void;
    } | null;
  },
  viewportId: string,
  body: UsAnnotationsBody
): void {
  const toolGroup = toolGroupService.getToolGroupForViewport(viewportId);
  if (!toolGroup) {
    return;
  }
  const config: Record<string, unknown> = {};
  if (body.angle1 !== undefined) {
    config.startAngle = body.angle1;
  }
  if (body.angle2 !== undefined) {
    config.endAngle = body.angle2;
  }
  if (body.center_rows_px !== undefined && body.center_cols_px !== undefined) {
    config.center = [body.center_rows_px, body.center_cols_px];
  }
  if (body.radius1 !== undefined) {
    config.innerRadius = body.radius1;
  }
  if (body.radius2 !== undefined) {
    config.outerRadius = body.radius2;
  }
  if (Object.keys(config).length) {
    toolGroup.setToolConfiguration(US_TOOL_NAME, config);
  }
}

function addLineAnnotation(
  element: HTMLElement,
  viewportId: string,
  referencedImageId: string,
  segment: number[][],
  annotationType: typeof PLEURA | typeof BLINE,
  imageData: Types.IImageData
): void {
  const [index1, index2] = segment;
  const world1 = transformIndexToWorld(imageData, [
    index1[0],
    index1[1],
    index1[2] ?? 0,
  ] as Types.Point3);
  const world2 = transformIndexToWorld(imageData, [
    index2[0],
    index2[1],
    index2[2] ?? 0,
  ] as Types.Point3);
  const frameOfReferenceUID = metaData.get('FrameOfReferenceUID', referencedImageId);

  annotation.state.addAnnotation(
    {
      annotationUID: utilities.uuidv4(),
      highlighted: false,
      invalidated: false,
      isLocked: false,
      isVisible: true,
      metadata: {
        toolName: US_TOOL_NAME,
        referencedImageId,
        FrameOfReferenceUID: frameOfReferenceUID,
      },
      data: {
        handles: {
          points: [world1, world2],
          activeHandleIndex: null,
        },
        annotationType,
        label: '',
      },
    },
    element
  );
  triggerAnnotationRenderForViewportIds([viewportId]);
}

export function importUsPleuraBLineAnnotations(
  servicesManager: ServicesManagerLike,
  rawContext: unknown
): boolean {
  const context = asContext(rawContext);
  if (!context) {
    console.warn(`${LOG_PREFIX} annotation-update ignored: empty context`);
    return false;
  }

  if (context.toolName && context.toolName !== US_TOOL_NAME) {
    console.info(
      `${LOG_PREFIX} annotation-update ignored: toolName=${context.toolName}`
    );
    return false;
  }

  const body = context.annotations;
  if (!body?.frame_annotations) {
    console.warn(`${LOG_PREFIX} annotation-update ignored: missing frame_annotations`);
    return false;
  }

  const seriesInstanceUID = (context.seriesInstanceUID ?? '').trim();
  if (!seriesInstanceUID) {
    console.warn(`${LOG_PREFIX} annotation-update ignored: missing seriesInstanceUID`);
    return false;
  }

  const studyInstanceUID = (context.studyInstanceUID ?? '').trim();
  const resolved = resolveViewportForSeries(
    servicesManager,
    studyInstanceUID,
    seriesInstanceUID
  );
  if (!resolved) {
    pendingAnnotationContext = context;
    console.info(
      `${LOG_PREFIX} annotation-update queued until series ${seriesInstanceUID} is loaded`
    );
    return false;
  }

  const { viewportId, viewport, toolGroupService } = resolved;
  const element = viewport.element;
  const imageData = viewport.getImageData()?.imageData;
  if (!element || !imageData) {
    pendingAnnotationContext = context;
    console.info(`${LOG_PREFIX} annotation-update queued: viewport image data not ready`);
    return false;
  }

  applyFanConfiguration(toolGroupService, viewportId, body);
  clearUsAnnotations(element);

  const viewportImageIds = viewport.getImageIds();
  const frameAnnotations = body.frame_annotations;

  for (const [frameKey, frameData] of Object.entries(frameAnnotations)) {
    const frameIndex = Number(frameKey);
    if (!Number.isFinite(frameIndex) || frameIndex < 0) {
      continue;
    }
    const referencedImageId = viewportImageIds[frameIndex];
    if (!referencedImageId) {
      continue;
    }

    for (const segment of frameData.pleura_lines ?? []) {
      if (segment?.length === 2) {
        addLineAnnotation(element, viewportId, referencedImageId, segment, PLEURA, imageData);
      }
    }
    for (const segment of frameData.b_lines ?? []) {
      if (segment?.length === 2) {
        addLineAnnotation(element, viewportId, referencedImageId, segment, BLINE, imageData);
      }
    }
  }

  viewport.render();
  pendingAnnotationContext = null;
  console.info(`${LOG_PREFIX} annotation-update applied for series ${seriesInstanceUID}`);
  return true;
}

export function deleteUsPleuraBLineAnnotations(servicesManager: ServicesManagerLike): void {
  const services = servicesManager.services as AppTypes.Services;
  const { viewportGridService, cornerstoneViewportService } = services;
  const activeViewportId = viewportGridService.getActiveViewportId();
  if (!activeViewportId) {
    return;
  }
  const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
  if (!viewport?.element) {
    return;
  }
  clearUsAnnotations(viewport.element);
  viewport.render();
  console.info(`${LOG_PREFIX} annotation-delete cleared US pleura/B-line annotations`);
}

export function tryApplyPendingUsAnnotations(
  servicesManager: ServicesManagerLike
): void {
  if (!pendingAnnotationContext) {
    return;
  }
  const context = pendingAnnotationContext;
  pendingAnnotationContext = null;
  importUsPleuraBLineAnnotations(servicesManager, context);
}
