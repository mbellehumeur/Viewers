import {
  getSlicerLiveVolume3D,
  SLICERLIVE_VOLUME_3D_RENDER_MODE,
} from '@cornerstonejs/core';
import { Enums as csToolsEnums } from '@cornerstonejs/tools';
import {
  applySlicerLiveSegmentationFromOHIF,
  applySlicerLiveSegmentationProgressive,
  finalizeSlicerLiveSegmentationProgressive,
} from './slicerLiveSegBridge';
import { getVolume3DRenderModeOverride } from './nextViewports';

const { Labelmap: LABELMAP } = csToolsEnums.SegmentationRepresentations;

/** Viewports that were (or should be) SlicerLive Volume3D — survives SEG remount teardown. */
const slicerLiveViewportIds = new Set<string>();

/** viewportId -> segmentationId successfully applied to SlicerLive */
const appliedSlicerLiveSegByViewport = new Map<string, string>();

/** `${viewportId}:${segId}` -> in-flight hydrate (dedupes double-clicks) */
const hydrateInFlight = new Map<string, Promise<void>>();

function hydrateKey(viewportId: string, segmentationId: string): string {
  return `${viewportId}:${segmentationId}`;
}

type Services = {
  displaySetService: {
    getDisplaySetByUID: (uid: string) => AppTypes.DisplaySet | undefined;
  };
  segmentationService: {
    getSegmentation: (id: string) => unknown;
    getSegmentationRepresentations?: (
      viewportId: string,
      specifier?: { segmentationId?: string; type?: unknown }
    ) => Array<{ segmentationId?: string }>;
    addSegmentationRepresentation: (
      viewportId: string,
      opts: Record<string, unknown>
    ) => Promise<unknown>;
    getSegmentColor: (
      viewportId: string,
      segmentationId: string,
      segmentIndex: number
    ) => number[] | undefined;
    getLabelmapVolume: (segmentationId: string) => unknown;
    EVENTS?: { SEGMENT_LOADING_COMPLETE?: string };
    subscribe?: (
      eventName: string,
      callback: (evt: {
        percentComplete?: number;
        filledSliceCount?: number;
        segDisplaySet?: AppTypes.DisplaySet;
      }) => void
    ) => { unsubscribe: () => void };
  };
  userAuthenticationService?: {
    getAuthorizationHeader: () => Record<string, string> | undefined;
  };
  cornerstoneViewportService?: {
    storePresentation?: (opts: { viewportId: string }) => void;
    getCornerstoneViewport?: (viewportId: string) => {
      type?: string;
      getActiveRenderMode?: () => string;
    } | null;
  };
  uiNotificationService?: {
    show: (notification: Record<string, unknown>) => string | void;
  };
};

/** Remember that this viewport id is intended for SlicerLive Volume3D. */
export function markSlicerLiveVolumeViewport(viewportId: string, active = true): void {
  if (!viewportId) {
    return;
  }
  if (active) {
    slicerLiveViewportIds.add(viewportId);
  } else {
    slicerLiveViewportIds.delete(viewportId);
  }
}

/** Clear applied-SEG tracking when overlay is removed from a viewport. */
export function clearAppliedSlicerLiveSegForViewport(viewportId: string): void {
  if (!viewportId) {
    return;
  }
  appliedSlicerLiveSegByViewport.delete(viewportId);
}

function isSlicerLiveSegAlreadyApplied(
  viewportId: string,
  displaySetInstanceUID: string,
  displaySet: AppTypes.DisplaySet,
  segmentationService: Services['segmentationService']
): boolean {
  if (!displaySet.isLoaded) {
    return false;
  }
  if (!segmentationService.getSegmentation(displaySetInstanceUID)) {
    return false;
  }

  if (appliedSlicerLiveSegByViewport.get(viewportId) === displaySetInstanceUID) {
    return true;
  }

  const reps = segmentationService.getSegmentationRepresentations?.(viewportId, {
    segmentationId: displaySetInstanceUID,
  });
  return Array.isArray(reps) && reps.length > 0;
}

function showAlreadyLoadedNotification(
  uiNotificationService: Services['uiNotificationService'],
  displaySetInstanceUID: string
): void {
  uiNotificationService?.show({
    id: `slicer-live-seg-already-${displaySetInstanceUID}`,
    title: 'Segmentation',
    message: 'Segmentation already loaded',
    type: 'info',
    duration: 3000,
    allowDuplicates: false,
  });
}

/**
 * True when this viewport is (or should be) SlicerLive Volume3D — including after
 * a SEG viewport remount tore down the live registry entry.
 */
export function shouldUseSlicerLiveSegHydration(
  viewportId: string,
  servicesManager?: { services: Services }
): boolean {
  if (!viewportId) {
    return false;
  }

  if (getSlicerLiveVolume3D(viewportId)) {
    markSlicerLiveVolumeViewport(viewportId, true);
    return true;
  }

  if (getVolume3DRenderModeOverride() === SLICERLIVE_VOLUME_3D_RENDER_MODE) {
    return true;
  }

  if (slicerLiveViewportIds.has(viewportId)) {
    return true;
  }

  const viewport = servicesManager?.services?.cornerstoneViewportService?.getCornerstoneViewport?.(
    viewportId
  );
  if (viewport?.getActiveRenderMode?.() === SLICERLIVE_VOLUME_3D_RENDER_MODE) {
    markSlicerLiveVolumeViewport(viewportId, true);
    return true;
  }

  return false;
}

/** True when this viewport is currently rendering via SlicerLive Volume3D. */
export function isSlicerLiveVolumeViewport(viewportId: string): boolean {
  return shouldUseSlicerLiveSegHydration(viewportId);
}

async function waitForSlicerLiveVolume(
  viewportId: string,
  timeoutMs = 15000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (getSlicerLiveVolume3D(viewportId)) {
      markSlicerLiveVolumeViewport(viewportId, true);
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
}

/**
 * If the thumbnail is a SEG and the viewport is SlicerLive, hydrate without remount.
 * Returns true when handled (caller should skip setDisplaySets remount).
 */
export async function tryHydrateSlicerLiveSegFromThumbnail(params: {
  viewportId: string;
  displaySetInstanceUID: string;
  servicesManager: { services: Services };
}): Promise<boolean> {
  const { viewportId, displaySetInstanceUID, servicesManager } = params;
  const displaySet =
    servicesManager.services.displaySetService.getDisplaySetByUID(displaySetInstanceUID);

  if (!displaySet || displaySet.Modality !== 'SEG') {
    return false;
  }

  if (!shouldUseSlicerLiveSegHydration(viewportId, servicesManager)) {
    return false;
  }

  return hydrateSlicerLiveSegmentationOverlay({
    viewportId,
    displaySetInstanceUID,
    servicesManager,
  });
}

async function runSlicerLiveSegHydration(params: {
  viewportId: string;
  displaySetInstanceUID: string;
  displaySet: AppTypes.DisplaySet;
  servicesManager: { services: Services };
  waitForRemount: boolean;
}): Promise<void> {
  const { viewportId, displaySetInstanceUID, displaySet, servicesManager, waitForRemount } =
    params;
  const {
    segmentationService,
    userAuthenticationService,
    cornerstoneViewportService,
  } = servicesManager.services;

  if (waitForRemount || !getSlicerLiveVolume3D(viewportId)) {
    const ready = await waitForSlicerLiveVolume(viewportId);
    if (!ready) {
      throw new Error(`Timed out waiting for SlicerLive on "${viewportId}"`);
    }
  }

  let progressiveRaf = 0;
  const scheduleProgressive = () => {
    if (progressiveRaf) {
      return;
    }
    progressiveRaf = requestAnimationFrame(() => {
      progressiveRaf = 0;
      void applySlicerLiveSegmentationProgressive({
        viewportId,
        displaySet: displaySet as Parameters<
          typeof applySlicerLiveSegmentationProgressive
        >[0]['displaySet'],
        segmentationId: displaySetInstanceUID,
        segmentationService: segmentationService as Parameters<
          typeof applySlicerLiveSegmentationProgressive
        >[0]['segmentationService'],
      });
    });
  };

  const progressEvent =
    segmentationService.EVENTS?.SEGMENT_LOADING_COMPLETE ??
    'event::segment_loading_complete';
  let unsubscribeProgress: (() => void) | undefined;
  if (typeof segmentationService.subscribe === 'function') {
    const { unsubscribe } = segmentationService.subscribe(
      progressEvent,
      evt => {
        if (
          evt.segDisplaySet &&
          evt.segDisplaySet.displaySetInstanceUID !== displaySetInstanceUID
        ) {
          return;
        }
        scheduleProgressive();
      }
    );
    unsubscribeProgress = unsubscribe;
  }

  try {
    // Start load without blocking first progressive paint.
    const headers = userAuthenticationService?.getAuthorizationHeader?.();
    const loadPromise =
      !displaySet.isLoaded && typeof displaySet.load === 'function'
        ? displaySet.load({ headers })
        : Promise.resolve();

    // Opportunistic apply if scaffolding already published.
    scheduleProgressive();

    await loadPromise;

    if (progressiveRaf) {
      cancelAnimationFrame(progressiveRaf);
      progressiveRaf = 0;
    }

    // Final progressive sync + SDF settle (or one-shot fallback).
    await applySlicerLiveSegmentationProgressive({
      viewportId,
      displaySet: displaySet as Parameters<
        typeof applySlicerLiveSegmentationProgressive
      >[0]['displaySet'],
      segmentationId: displaySetInstanceUID,
      segmentationService: segmentationService as Parameters<
        typeof applySlicerLiveSegmentationProgressive
      >[0]['segmentationService'],
    });
    const finalized = await finalizeSlicerLiveSegmentationProgressive(viewportId);

    if (!segmentationService.getSegmentation(displaySetInstanceUID)) {
      // createSegmentationForSEGDisplaySet runs inside displaySet.load(); if it
      // somehow missed, fall back to one-shot after state exists.
      throw new Error(
        `SEG "${displaySetInstanceUID}" loaded but not in segmentation state`
      );
    }

    await segmentationService.addSegmentationRepresentation(viewportId, {
      segmentationId: displaySetInstanceUID,
      predecessorImageId: (displaySet as { predecessorImageId?: string })
        .predecessorImageId,
      type: LABELMAP,
    });

    cornerstoneViewportService?.storePresentation?.({ viewportId });

    // Final one-shot apply for correct segment colours / boundary mode once CS
    // segmentation state exists (progressive path already showed mid-load densify).
    const applied = await applySlicerLiveSegmentationFromOHIF(
      viewportId,
      displaySetInstanceUID,
      segmentationService as Parameters<
        typeof applySlicerLiveSegmentationFromOHIF
      >[2]
    );
    if (!applied && !finalized) {
      throw new Error(
        `Failed to apply SEG "${displaySetInstanceUID}" to SlicerLive`
      );
    }

    appliedSlicerLiveSegByViewport.set(viewportId, displaySetInstanceUID);
  } finally {
    unsubscribeProgress?.();
    if (progressiveRaf) {
      cancelAnimationFrame(progressiveRaf);
    }
  }
}

/**
 * Hydrate a SEG onto a SlicerLive Volume3D viewport without remounting
 * (keeps the CT VR visible while SEG decode / SDF bake runs).
 *
 * Data Overlay UI tracks overlays via segmentation representations, so we do
 * not need to push the SEG into viewport displaySetInstanceUIDs (that remount
 * is what blanks the volume today).
 *
 * Shows a non-blocking promise toast for loading / success / error feedback.
 */
export async function hydrateSlicerLiveSegmentationOverlay(params: {
  viewportId: string;
  displaySetInstanceUID: string;
  servicesManager: { services: Services };
  /** When true, wait for SlicerLive to remount after a prior SEG viewport swap. */
  waitForRemount?: boolean;
}): Promise<boolean> {
  const { viewportId, displaySetInstanceUID, servicesManager, waitForRemount = false } =
    params;
  const { displaySetService, uiNotificationService } = servicesManager.services;

  if (!shouldUseSlicerLiveSegHydration(viewportId, servicesManager)) {
    return false;
  }

  const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);
  if (!displaySet || displaySet.Modality !== 'SEG') {
    return false;
  }

  const { segmentationService } = servicesManager.services;

  if (
    isSlicerLiveSegAlreadyApplied(
      viewportId,
      displaySetInstanceUID,
      displaySet,
      segmentationService
    )
  ) {
    showAlreadyLoadedNotification(uiNotificationService, displaySetInstanceUID);
    return true;
  }

  const key = hydrateKey(viewportId, displaySetInstanceUID);
  const existing = hydrateInFlight.get(key);
  if (existing) {
    showAlreadyLoadedNotification(uiNotificationService, displaySetInstanceUID);
    try {
      await existing;
      return true;
    } catch {
      return false;
    }
  }

  const hydratePromise = runSlicerLiveSegHydration({
    viewportId,
    displaySetInstanceUID,
    displaySet,
    servicesManager,
    waitForRemount,
  });
  hydrateInFlight.set(key, hydratePromise);

  uiNotificationService?.show({
    id: `slicer-live-seg-${displaySetInstanceUID}`,
    title: 'Segmentation',
    message: 'Loading segmentation…',
    allowDuplicates: false,
    promise: hydratePromise,
    promiseMessages: {
      loading: 'Loading segmentation…',
      success: 'Segmentation ready',
      error: 'Failed to load segmentation',
    },
  });

  try {
    await hydratePromise;
    return true;
  } catch (error) {
    console.warn(
      `[hydrateSlicerLiveSegmentationOverlay] Failed for "${displaySetInstanceUID}":`,
      error
    );
    return false;
  } finally {
    hydrateInFlight.delete(key);
  }
}
