import {
  getSlicerLiveVolume3D,
  SLICERLIVE_VOLUME_3D_RENDER_MODE,
} from '@cornerstonejs/core';
import { Enums as csToolsEnums } from '@cornerstonejs/tools';
import { applySlicerLiveSegmentationFromOHIF } from './slicerLiveSegBridge';
import { getVolume3DRenderModeOverride } from './nextViewports';

const { Labelmap: LABELMAP } = csToolsEnums.SegmentationRepresentations;

/** Viewports that were (or should be) SlicerLive Volume3D — survives SEG remount teardown. */
const slicerLiveViewportIds = new Set<string>();

type Services = {
  displaySetService: {
    getDisplaySetByUID: (uid: string) => AppTypes.DisplaySet | undefined;
  };
  segmentationService: {
    getSegmentation: (id: string) => unknown;
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
 * Hydrate a SEG onto a SlicerLive Volume3D viewport without remounting
 * (keeps the CT VR visible while SEG decode / SDF bake runs).
 *
 * Data Overlay UI tracks overlays via segmentation representations, so we do
 * not need to push the SEG into viewport displaySetInstanceUIDs (that remount
 * is what blanks the volume today).
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
  const {
    displaySetService,
    segmentationService,
    userAuthenticationService,
    cornerstoneViewportService,
  } = servicesManager.services;

  if (!shouldUseSlicerLiveSegHydration(viewportId, servicesManager)) {
    return false;
  }

  const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);
  if (!displaySet || displaySet.Modality !== 'SEG') {
    return false;
  }

  try {
    if (!displaySet.isLoaded && typeof displaySet.load === 'function') {
      const headers = userAuthenticationService?.getAuthorizationHeader?.();
      await displaySet.load({ headers });
    }

    if (waitForRemount || !getSlicerLiveVolume3D(viewportId)) {
      const ready = await waitForSlicerLiveVolume(viewportId);
      if (!ready) {
        console.warn(
          `[hydrateSlicerLiveSegmentationOverlay] Timed out waiting for SlicerLive on "${viewportId}"`
        );
        return false;
      }
    }

    if (!segmentationService.getSegmentation(displaySetInstanceUID)) {
      console.warn(
        `[hydrateSlicerLiveSegmentationOverlay] SEG "${displaySetInstanceUID}" loaded but not in segmentation state`
      );
      return false;
    }

    await segmentationService.addSegmentationRepresentation(viewportId, {
      segmentationId: displaySetInstanceUID,
      predecessorImageId: (displaySet as { predecessorImageId?: string }).predecessorImageId,
      type: LABELMAP,
    });

    cornerstoneViewportService?.storePresentation?.({ viewportId });

    await applySlicerLiveSegmentationFromOHIF(
      viewportId,
      displaySetInstanceUID,
      segmentationService as Parameters<typeof applySlicerLiveSegmentationFromOHIF>[2]
    );

    return true;
  } catch (error) {
    console.warn(
      `[hydrateSlicerLiveSegmentationOverlay] Failed for "${displaySetInstanceUID}":`,
      error
    );
    return false;
  }
}
