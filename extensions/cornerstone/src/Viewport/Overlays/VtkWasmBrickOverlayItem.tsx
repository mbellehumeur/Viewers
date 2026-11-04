import React, { useCallback, useEffect, useState } from 'react';
import {
  Enums,
  eventTarget,
  formatVtkWasmBrickLabel,
  resolveVtkWasmBrickSummary,
} from '@cornerstonejs/core';

type VtkWasmBrickOverlayItemProps = {
  element: HTMLElement;
  viewportId: string;
  servicesManager: AppTypes.ServicesManager;
};

function VtkWasmBrickOverlayItem({
  element,
  viewportId,
  servicesManager,
}: VtkWasmBrickOverlayItemProps) {
  const { cornerstoneViewportService } = servicesManager.services;
  const [label, setLabel] = useState<string | null>(null);

  const sync = useCallback(() => {
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    const summary = resolveVtkWasmBrickSummary(viewport);
    if (summary) {
      setLabel(formatVtkWasmBrickLabel(summary));
    }
  }, [cornerstoneViewportService, viewportId]);

  const syncOrClear = useCallback(() => {
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    const summary = resolveVtkWasmBrickSummary(viewport);
    setLabel(summary ? formatVtkWasmBrickLabel(summary) : null);
  }, [cornerstoneViewportService, viewportId]);

  useEffect(() => {
    sync();
    // Volume3D vtk-wasm binds brickPlan asynchronously after mount.
    const delayedSyncId = window.setTimeout(sync, 0);

    element.addEventListener(Enums.Events.IMAGE_RENDERED, sync);
    eventTarget.addEventListener(
      Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED,
      sync
    );

    const { unsubscribe: unsubscribeViewportData } =
      cornerstoneViewportService.subscribe(
        cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED,
        (props: { viewportId?: string }) => {
          if (props.viewportId !== viewportId) {
            return;
          }
          syncOrClear();
        }
      );

    return () => {
      window.clearTimeout(delayedSyncId);
      element.removeEventListener(Enums.Events.IMAGE_RENDERED, sync);
      eventTarget.removeEventListener(
        Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED,
        sync
      );
      unsubscribeViewportData();
    };
  }, [cornerstoneViewportService, element, sync, syncOrClear, viewportId]);

  if (!label) {
    return null;
  }

  return (
    <div className="overlay-item flex flex-row font-mono">
      <span>{label}</span>
    </div>
  );
}

export default VtkWasmBrickOverlayItem;
