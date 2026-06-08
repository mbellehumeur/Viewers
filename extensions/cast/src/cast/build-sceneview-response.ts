import { captureViewportThumbnailPng } from './get-response-image';
import type { ServicesManagerLike } from './types';

export type SceneviewThumbnail = {
  contentType: 'image/png' | 'image/jpeg';
  data: string;
  width: number;
  height: number;
};

export type SceneviewScreenRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type SceneviewViewport = {
  viewId: string;
  slotIndex: number;
  name: string;
  screenRect: SceneviewScreenRect | null;
  layoutRect: SceneviewScreenRect | null;
  studyInstanceUID?: string;
  seriesInstanceUID?: string;
  displaySetInstanceUID?: string;
  thumbnail?: SceneviewThumbnail;
};

export type SceneviewResponsePayload = {
  source: 'sceneview';
  product: string;
  window: {
    screenX: number;
    screenY: number;
    outerWidth: number;
    outerHeight: number;
    innerWidth: number;
    innerHeight: number;
  };
  display: {
    layoutName: string | null;
    activeViewId: string | null;
    layoutScreenRect: SceneviewScreenRect | null;
    layoutClientSize: { width: number; height: number } | null;
  };
  viewports: SceneviewViewport[];
};

export function isSceneviewRequestDataType(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  return value.trim().toUpperCase() === 'SCENEVIEW';
}

/** Screen top-left of the browser viewport (Chromium: window.screenX / screenY). */
function getWindowContentScreenOrigin(): { x: number; y: number } {
  if (typeof window === 'undefined') {
    return { x: 0, y: 0 };
  }
  return {
    x: window.screenX,
    y: window.screenY,
  };
}

function elementScreenRect(element: Element | null): SceneviewScreenRect | null {
  if (!element || typeof element.getBoundingClientRect !== 'function') {
    return null;
  }
  const rect = element.getBoundingClientRect();
  const origin = getWindowContentScreenOrigin();
  return {
    left: Math.round(origin.x + rect.left),
    top: Math.round(origin.y + rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

/** Viewport bounds in layout-grid-local coordinates (matches layoutClientSize). */
function elementLayoutRect(
  element: Element | null,
  gridRoot: Element | null
): SceneviewScreenRect | null {
  if (
    !element ||
    !gridRoot ||
    typeof element.getBoundingClientRect !== 'function' ||
    typeof gridRoot.getBoundingClientRect !== 'function'
  ) {
    return null;
  }
  const gridRect = gridRoot.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  return {
    left: Math.round(elementRect.left - gridRect.left),
    top: Math.round(elementRect.top - gridRect.top),
    width: Math.max(1, Math.round(elementRect.width)),
    height: Math.max(1, Math.round(elementRect.height)),
  };
}

function findViewportElement(viewportId: string): Element | null {
  if (typeof document === 'undefined') {
    return null;
  }
  return (
    document.querySelector(`[data-viewport-uid="${CSS.escape(viewportId)}"]`) ||
    document.querySelector(`[data-viewport-id="${CSS.escape(viewportId)}"]`) ||
    document.querySelector(`[data-viewportid="${CSS.escape(viewportId)}"]`) ||
    document.querySelector(`[data-cast-view-id="${CSS.escape(viewportId)}"]`)
  );
}

export function buildSceneviewResponsePayload(
  productName: string,
  servicesManager: ServicesManagerLike
): SceneviewResponsePayload {
  const { viewportGridService, displaySetService } = servicesManager.services;
  const state = viewportGridService.getState();
  const viewportsMap = state?.viewports;
  const activeViewId = viewportGridService.getActiveViewportId() ?? null;

  const gridRoot =
    typeof document !== 'undefined'
      ? document.querySelector('.viewport-grid, [data-cy="viewport-grid"]')
      : null;

  const viewports: SceneviewViewport[] = [];
  let slotIndex = 0;

  if (viewportsMap?.size) {
    for (const [mapKey, vp] of viewportsMap) {
      const viewId = vp.viewportId ?? mapKey;
      const element = findViewportElement(viewId);
      const displaySetUid = vp.displaySetInstanceUIDs?.[0];
      let studyInstanceUID: string | undefined;
      let seriesInstanceUID: string | undefined;

      if (displaySetUid && displaySetService.activeDisplaySets) {
        const ds = displaySetService.activeDisplaySets.find(
          entry => entry.displaySetInstanceUID === displaySetUid
        );
        studyInstanceUID = ds?.StudyInstanceUID;
        seriesInstanceUID = ds?.SeriesInstanceUID;
      }

      const thumbnail = captureViewportThumbnailPng(viewId);
      viewports.push({
        viewId,
        slotIndex: slotIndex++,
        name: viewId,
        screenRect: elementScreenRect(element),
        layoutRect: elementLayoutRect(element, gridRoot),
        studyInstanceUID,
        seriesInstanceUID,
        displaySetInstanceUID: displaySetUid,
        thumbnail: thumbnail ?? undefined,
      });
    }
  }

  const layoutClientSize = gridRoot
    ? {
        width: Math.round(gridRoot.clientWidth),
        height: Math.round(gridRoot.clientHeight),
      }
    : null;

  return {
    source: 'sceneview',
    product: productName,
    window:
      typeof window !== 'undefined'
        ? {
            screenX: window.screenX,
            screenY: window.screenY,
            outerWidth: window.outerWidth,
            outerHeight: window.outerHeight,
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
          }
        : {
            screenX: 0,
            screenY: 0,
            outerWidth: 0,
            outerHeight: 0,
            innerWidth: 0,
            innerHeight: 0,
          },
    display: {
      layoutName: null,
      activeViewId,
      layoutScreenRect: elementScreenRect(gridRoot),
      layoutClientSize,
    },
    viewports,
  };
}
