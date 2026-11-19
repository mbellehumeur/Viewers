import * as cornerstoneTools from '@cornerstonejs/tools';
import { updateSegmentationStats } from './updateSegmentationStats';
import { useSelectedSegmentationsForViewportStore } from '../stores';
import { SegmentationRepresentations } from '@cornerstonejs/tools/enums';
import { isVolume3DViewportType } from './getLegacyViewportType';

/**
 * Sets up the handler for segmentation data modification events
 */
export function setupSegmentationDataModifiedHandler({
  segmentationService,
  customizationService,
  commandsManager,
}) {
  // A flag to indicate if the event is unsubscribed to. This is important because
  // the debounced callback does an await and in that period of time the event may have
  // been unsubscribed.
  let isUnsubscribed = false;
  const { unsubscribe: debouncedUnsubscribe } = segmentationService.subscribeDebounced(
    segmentationService.EVENTS.SEGMENTATION_DATA_MODIFIED,
    async ({ segmentationId }) => {
      const disableUpdateSegmentationStats = customizationService.getCustomization(
        'panelSegmentation.disableUpdateSegmentationStats'
      );

      const segmentation = segmentationService.getSegmentation(segmentationId);

      if (!segmentation || disableUpdateSegmentationStats) {
        return;
      }

      const readableText = customizationService.getCustomization('panelSegmentation.readableText');

      // Check for segments with bidirectional measurements and update them
      const segmentIndices = Object.keys(segmentation.segments)
        .map(index => parseInt(index))
        .filter(index => index > 0);

      for (const segmentIndex of segmentIndices) {
        const segment = segmentation.segments[segmentIndex];
        if (segment?.cachedStats?.namedStats?.bidirectional) {
          // Run the command to update the bidirectional measurement
          commandsManager.runCommand('runSegmentBidirectional', {
            segmentationId,
            segmentIndex,
          });
        }
      }

      const updatedSegmentation = await updateSegmentationStats({
        segmentation,
        segmentationId,
        readableText,
      });

      if (!isUnsubscribed && updatedSegmentation) {
        const existingSegmentation = segmentationService.getSegmentation(segmentationId);

        if (existingSegmentation) {
          segmentationService.addOrUpdateSegmentation({
            segmentationId,
            segments: updatedSegmentation.segments,
          });
        }
      }
    },
    1000
  );

  const unsubscribe = () => {
    isUnsubscribed = true;
    debouncedUnsubscribe();
  };
  return { unsubscribe };
}

/**
 * Sets up the handler for segmentation modification events
 */
export function setupSegmentationModifiedHandler({ segmentationService }) {
  const { unsubscribe } = segmentationService.subscribe(
    segmentationService.EVENTS.SEGMENTATION_MODIFIED,
    async ({ segmentationId }) => {
      const segmentation = segmentationService.getSegmentation(segmentationId);

      if (!segmentation) {
        return;
      }

      const annotationState = cornerstoneTools.annotation.state.getAllAnnotations();
      const bidirectionalAnnotations = annotationState.filter(
        annotation =>
          annotation.metadata.toolName === cornerstoneTools.SegmentBidirectionalTool.toolName
      );

      const segmentIndices = Object.keys(segmentation.segments)
        .map(index => parseInt(index))
        .filter(index => index > 0);

      // check if there is a bidirectional data that exists but the segment
      // does not exists anymore we need to remove the bidirectional data
      const bidirectionalAnnotationsToRemove = bidirectionalAnnotations.filter(
        annotation =>
          annotation.metadata.segmentationId === segmentationId &&
          !segmentIndices.includes(annotation.metadata.segmentIndex)
      );

      const toRemoveUIDs = bidirectionalAnnotationsToRemove.map(
        annotation => annotation.annotationUID
      );

      toRemoveUIDs.forEach(uid => {
        cornerstoneTools.annotation.state.removeAnnotation(uid);
      });
    }
  );

  return { unsubscribe };
}

/**
 * Resolves the hanging-protocol / display-set volume-rendering preset for a viewport.
 * displayPreset may be a string or a modality map ({ CT: 'CT-Bone', default: 'CT-Bone' }).
 * Falls back to primary3D defaults when HP options were dropped on remount.
 */
function resolveVolume3dPresetName({
  viewportId,
  cornerstoneViewportService,
  displaySetService,
  viewportGridService,
}: {
  viewportId: string;
  cornerstoneViewportService;
  displaySetService;
  viewportGridService;
}): string {
  const uids = viewportGridService.getDisplaySetsUIDsForViewport?.(viewportId) || [];
  const background = uids
    .map(uid => displaySetService.getDisplaySetByUID(uid))
    .find(ds => ds && !ds.isOverlayDisplaySet);
  const modality = background?.Modality;

  const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);
  const displayPreset = viewportInfo?.getDisplaySetOptions?.()?.[0]?.displayPreset;
  if (typeof displayPreset === 'string' && displayPreset) {
    return displayPreset;
  }
  if (displayPreset && typeof displayPreset === 'object') {
    const fromMap = displayPreset[modality] || displayPreset.default;
    if (fromMap) {
      return fromMap;
    }
  }

  if (modality === 'MR') {
    return 'MR-Default';
  }
  return 'CT-Bone';
}

/** Late enough for Surface worker + actor attach to finish wiping the VR TF. */
const PRESET_REAPPLY_DELAY_MS = 300;

/**
 * Labelmap→Surface conversion for volume3d finishes asynchronously (worker) and can
 * clear the VR transfer function after CT-Bone was already applied. Re-apply the
 * hanging-protocol preset once Surface representation data exists — the same action
 * that restores the volume when the user sets the transfer function manually.
 */
export function setupVolume3dPresetAfterSurfaceHandler({
  segmentationService,
  cornerstoneViewportService,
  displaySetService,
  viewportGridService,
  commandsManager,
}) {
  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const clearPending = (viewportId: string) => {
    const timer = pendingTimers.get(viewportId);
    if (timer !== undefined) {
      clearTimeout(timer);
      pendingTimers.delete(viewportId);
    }
  };

  const scheduleReapplyPresetForViewport = (viewportId: string) => {
    if (!viewportId) {
      return;
    }
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    if (!viewport || !isVolume3DViewportType(viewport)) {
      return;
    }

    const preset = resolveVolume3dPresetName({
      viewportId,
      cornerstoneViewportService,
      displaySetService,
      viewportGridService,
    });

    // Coalesce rapid Surface-modified events into one restore.
    clearPending(viewportId);
    const timer = setTimeout(() => {
      pendingTimers.delete(viewportId);
      const liveViewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      if (!liveViewport || !isVolume3DViewportType(liveViewport)) {
        return;
      }
      commandsManager.runCommand('setViewportPreset', { viewportId, preset });
    }, PRESET_REAPPLY_DELAY_MS);
    pendingTimers.set(viewportId, timer);
  };

  // Surface geometry overwrite ("Representation data of type Surface already exists")
  // is broadcast as SEGMENTATION_MODIFIED. Only restore volume3d panes that already
  // carry this segmentation — not every 3D viewport.
  const { unsubscribe: unsubscribeSegmentationModified } = segmentationService.subscribe(
    segmentationService.EVENTS.SEGMENTATION_MODIFIED,
    ({ segmentationId }) => {
      if (!segmentationId) {
        return;
      }
      const segmentation = segmentationService.getSegmentation(segmentationId);
      const hasSurfaceData = Boolean(
        segmentation?.representationData?.[SegmentationRepresentations.Surface]
      );
      if (!hasSurfaceData) {
        return;
      }

      const { viewports } = viewportGridService.getState();
      viewports.forEach((_viewport, viewportId) => {
        const reps = segmentationService.getSegmentationRepresentations(viewportId, {
          segmentationId,
        });
        if (!reps?.length) {
          return;
        }
        scheduleReapplyPresetForViewport(viewportId);
      });
    }
  );

  const unsubscribe = () => {
    pendingTimers.forEach(timer => clearTimeout(timer));
    pendingTimers.clear();
    unsubscribeSegmentationModified();
  };

  return { unsubscribe };
}

/**
 * Sets up auto tab switching for when the first segmentation is added into the viewer.
 */
export function setUpSelectedSegmentationsForViewportHandler({ segmentationService }) {
  const selectedSegmentationsForViewportEvents = [
    segmentationService.EVENTS.SEGMENTATION_MODIFIED,
    segmentationService.EVENTS.SEGMENTATION_REPRESENTATION_MODIFIED,
  ];

  const unsubscribeSelectedSegmentationsForViewportEvents = selectedSegmentationsForViewportEvents
    .map(eventName =>
      segmentationService.subscribe(eventName, event => {
        const { viewportId } = event;

        if (!viewportId) {
          return;
        }

        const { selectedSegmentationsForViewport, setSelectedSegmentationsForViewport } =
          useSelectedSegmentationsForViewportStore.getState();

        const representations = segmentationService.getSegmentationRepresentations(viewportId);

        const activeRepresentation = representations.find(representation => representation.active);

        const typeToSegmentationIdMap =
          selectedSegmentationsForViewport[viewportId] ??
          new Map<SegmentationRepresentations, string>();

        if (activeRepresentation) {
          typeToSegmentationIdMap.set(
            activeRepresentation.type,
            activeRepresentation.segmentationId
          );
        } else {
          typeToSegmentationIdMap.clear();
        }

        setSelectedSegmentationsForViewport(viewportId, typeToSegmentationIdMap);
      })
    )
    .map(subscription => subscription.unsubscribe);

  return { unsubscribeSelectedSegmentationsForViewportEvents };
}
