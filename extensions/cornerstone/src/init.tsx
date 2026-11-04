import OHIF, { errorHandler } from '@ohif/core';
import React from 'react';

import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';
import {
  init as cs3DInit,
  eventTarget,
  EVENTS,
  metaData,
  volumeLoader,
  imageLoadPoolManager,
  getEnabledElement,
  Settings,
  utilities as csUtilities,
  registerWebGPURenderBackend,
  isWebGPURenderingAvailable,
  registerVtkWasmRenderBackend,
  isVtkWasmAvailable,
  isVtkWasmWebgpuAvailable,
  VTK_WASM_RENDER_BACKEND,
} from '@cornerstonejs/core';
import {
  cornerstoneStreamingImageVolumeLoader,
  cornerstoneStreamingDynamicImageVolumeLoader,
} from '@cornerstonejs/core/loaders';

import RequestTypes from '@cornerstonejs/core/enums/RequestType';

import initWADOImageLoader from './initWADOImageLoader';
import initCornerstoneTools from './initCornerstoneTools';

import { connectToolsToMeasurementService } from './initMeasurementService';
import initCineService from './initCineService';
import initStudyPrefetcherService from './initStudyPrefetcherService';
import {
  setNextViewportsEnabled,
  resolveNextViewportsEnabled,
  resolveViewportRendering,
  setViewportRenderingOverrides,
  resolveVolume3DRenderMode,
  setVolume3DRenderModeOverride,
  setVtkWasmRegistered,
  setVtkWasmWebgpuRegistered,
  isVtkWasmRegistered,
  isVtkWasmWebgpuRegistered,
} from './utils/nextViewports';
import interleaveCenterLoader from './utils/interleaveCenterLoader';
import centerSequentialLoader from './utils/centerSequentialLoader';
import nthLoader from './utils/nthLoader';
import interleaveTopToBottom from './utils/interleaveTopToBottom';
import initContextMenu from './initContextMenu';
import initDoubleClick from './initDoubleClick';
import initViewTiming from './utils/initViewTiming';
import { colormaps } from './utils/colormaps';
import { SegmentationRepresentations } from '@cornerstonejs/tools/enums';
import { useLutPresentationStore } from './stores/useLutPresentationStore';
import { usePositionPresentationStore } from './stores/usePositionPresentationStore';
import { useSegmentationPresentationStore } from './stores/useSegmentationPresentationStore';
import { imageRetrieveMetadataProvider } from '@cornerstonejs/core/utilities';
import { initializeWebWorkerProgressHandler } from './utils/initWebWorkerProgressHandler';

const { registerColormap } = csUtilities.colormap;

// TODO: Cypress tests are currently grabbing this from the window?
(window as any).cornerstone = cornerstone;
(window as any).cornerstoneTools = cornerstoneTools;
/**
 *
 */
export default async function init({
  servicesManager,
  commandsManager,
  extensionManager,
  appConfig,
}: withAppTypes): Promise<void> {
  // Use a public library path of PUBLIC_URL plus the component name
  // This safely separates components that are loaded as-is.
  window.PUBLIC_LIB_URL ||= './${component}/';

  // Note: this should run first before initializing the cornerstone
  // DO NOT CHANGE THE ORDER

  // Stats overlay: on when appConfig.statsOverlay is true, or ?debug=true.
  // Toggle at runtime with Ctrl+Shift+D.
  const statsOverlay =
    Boolean(appConfig.statsOverlay) ||
    new URLSearchParams(window.location.search).get('debug') === 'true';

  await cs3DInit({
    peerImport: appConfig.peerImport,
    debug: { statsOverlay },
  });

  if (isWebGPURenderingAvailable()) {
    try {
      registerWebGPURenderBackend();
    } catch (error) {
      console.warn('WebGPU backend registration failed:', error);
    }
  }

  // Experimental vtk.wasm (WebGL) planar + Volume3D backend. Optional peer;
  // registration must not crash init when @kitware/vtk-wasm is absent.
  setVtkWasmRegistered(false);
  setVtkWasmWebgpuRegistered(false);
  try {
    if (await isVtkWasmAvailable()) {
      await registerVtkWasmRenderBackend();
      setVtkWasmRegistered(true);
      try {
        if (await isVtkWasmWebgpuAvailable()) {
          setVtkWasmWebgpuRegistered(true);
        }
      } catch (error) {
        console.warn('vtk.wasm WebGPU probe failed:', error);
        setVtkWasmWebgpuRegistered(false);
      }
    }
  } catch (error) {
    console.warn('vtk.wasm backend registration failed:', error);
    setVtkWasmRegistered(false);
    setVtkWasmWebgpuRegistered(false);
  }

  cornerstone.setUseCPURendering(Boolean(appConfig.useCPURendering));

  // All native ("next") Generic Viewport settings live under one config object:
  // appConfig.genericViewports = { enabled, viewportRendering, renderMode }.
  const genericViewportsConfig = appConfig.genericViewports ?? {};

  // viewportRendering selects the render backend per-session:
  // `?viewportRendering=cpu|webgl|webgpu|vtkWasm|auto` for all viewports, plus
  // `?<viewportType>.viewportRendering=<backend>` (e.g.
  // `?orthographic.viewportRendering=cpu`) to override a single viewport type
  // via the per-mount renderBackend option. The global value maps to
  // cornerstone's setRenderBackend; 'cpu'/'gpu' additionally drive the legacy
  // useCPURendering flag so pre-generic viewports follow the same selection
  // (letting a session force GPU when the deployed config defaults to CPU).
  const { renderBackend, renderBackendByViewportType } = resolveViewportRendering(
    genericViewportsConfig.viewportRendering
  );
  // Prefer vtkWasm for planar MPR when registered and no explicit backend was chosen.
  // If config/URL asked for vtkWasm but registration failed, fall back to gpu.
  let effectiveRenderBackend =
    renderBackend ??
    (isVtkWasmRegistered() ? VTK_WASM_RENDER_BACKEND : undefined);
  if (
    effectiveRenderBackend === VTK_WASM_RENDER_BACKEND &&
    !isVtkWasmRegistered()
  ) {
    console.warn(
      'viewportRendering: vtkWasm requested but registration failed; falling back to gpu.'
    );
    effectiveRenderBackend = 'gpu';
  }
  if (effectiveRenderBackend) {
    if (effectiveRenderBackend === 'cpu') {
      cornerstone.setUseCPURendering(true);
    } else if (effectiveRenderBackend === 'gpu') {
      cornerstone.setUseCPURendering(false);
    }
    try {
      cornerstone.setRenderBackend(
        effectiveRenderBackend as cornerstone.RenderBackendValue
      );
    } catch (error) {
      console.warn(
        `viewportRendering: "${effectiveRenderBackend}" is not a registered render backend; ` +
          `keeping "${cornerstone.getRenderBackend()}".`,
        error
      );
    }
  }
  setViewportRenderingOverrides(renderBackendByViewportType);

  let resolvedVolume3DMode = resolveVolume3DRenderMode(
    (genericViewportsConfig as { renderMode?: unknown }).renderMode
  );
  if (resolvedVolume3DMode === 'vtkWasmVolume3d' && !isVtkWasmRegistered()) {
    console.warn(
      'renderMode: vtkWasmVolume3d requested but registration failed; falling back to vtkVolume3d.'
    );
    resolvedVolume3DMode = 'vtkVolume3d';
  }
  if (
    resolvedVolume3DMode === 'vtkWasmWebgpuVolume3d' &&
    !isVtkWasmWebgpuRegistered()
  ) {
    console.warn(
      'renderMode: vtkWasmWebgpuVolume3d requested but WebGPU probe failed; falling back to ' +
        (isVtkWasmRegistered() ? 'vtkWasmVolume3d' : 'vtkVolume3d') +
        '.'
    );
    resolvedVolume3DMode = isVtkWasmRegistered()
      ? 'vtkWasmVolume3d'
      : 'vtkVolume3d';
  }
  // Default Volume3D path: vtk-wasm when registered; otherwise config/URL or none.
  setVolume3DRenderModeOverride(
    resolvedVolume3DMode ??
      (isVtkWasmRegistered() ? 'vtkWasmVolume3d' : undefined)
  );

  cornerstone.setConfiguration({
    ...cornerstone.getConfiguration(),
    rendering: {
      ...cornerstone.getConfiguration().rendering,
      strictZSpacingForVolumeViewport: appConfig.strictZSpacingForVolumeViewport,
      // Opt-in: route legacy viewport types through the new GenericViewport render
      // paths while keeping the legacy public API via compatibility adapters.
      // No-op on cornerstone builds that predate the GenericViewport architecture.
      useGenericViewport: Boolean(appConfig.useGenericViewport),
  // Same-origin vtk-wasm tars (run `node scripts/fetch-vtk-wasm.mjs`).
  // JSPI browsers load jspi/ (Kitware latest); non-JSPI (iOS Safari) load
  // compat/ (9.7.0 sync). Dual URLs beat a single vtkWasmUrl pointing at latest.
  // webpackIgnore loader keeps blob glue import() native under Rspack.
  vtkWasm: {
    ...(cornerstone.getConfiguration().rendering?.vtkWasm ?? {}),
    ...(() => {
      const gv = genericViewportsConfig as {
        vtkWasmUrl?: string;
        vtkWasmJspiUrl?: string;
        vtkWasmCompatUrl?: string;
      };
      if (gv.vtkWasmUrl) {
        return { url: gv.vtkWasmUrl };
      }
      return {
        jspiUrl:
          gv.vtkWasmJspiUrl ?? '/vtk-wasm/jspi/vtk-wasm32-emscripten.tar.gz',
        compatUrl:
          gv.vtkWasmCompatUrl ??
          '/vtk-wasm/compat/vtk-9.7.0-wasm32-emscripten.tar.gz',
      };
    })(),
    urlIsGzip: true,
    volumeTextureBrickling: true,
    brickPartitions: {
      strategy: 'minimum',
    },
    brickPartitionsMpr: {
      strategy: 'fixed',
      partitions: [8, 8, 8],
    },
  },
    },
  });

  // Opt-in: drive viewports through the DIRECT native GenericViewport ("next")
  // API (PLANAR_NEXT, setDisplaySets, ...). Read by getCornerstoneViewportType
  // and the CornerstoneViewportService backend split. Distinct from
  // useGenericViewport above (which only enables cornerstone's compat remap).
  // resolveNextViewportsEnabled lets a `?useNextViewports=true` URL param opt in
  // per-session; when the param is absent, appConfig.genericViewports.enabled wins.
  setNextViewportsEnabled(resolveNextViewportsEnabled(genericViewportsConfig.enabled));

  // For debugging large datasets, otherwise prefer the defaults
  const { maxCacheSize } = appConfig;
  if (maxCacheSize) {
    cornerstone.cache.setMaxCacheSize(maxCacheSize);
  }

  initCornerstoneTools();

  Settings.getRuntimeSettings().set('useCursors', Boolean(appConfig.useCursors));

  const {
    userAuthenticationService,
    customizationService,
    uiModalService,
    uiNotificationService,
    cornerstoneViewportService,
    hangingProtocolService,
    viewportGridService,
    segmentationService,
    measurementService,
    colorbarService,
    displaySetService,
    toolbarService,
  } = servicesManager.services;

  toolbarService.registerEventForToolbarUpdate(colorbarService, [
    colorbarService.EVENTS.STATE_CHANGED,
  ]);

  toolbarService.registerEventForToolbarUpdate(segmentationService, [
    segmentationService.EVENTS.SEGMENTATION_MODIFIED,
    segmentationService.EVENTS.SEGMENTATION_REPRESENTATION_MODIFIED,
    segmentationService.EVENTS.SEGMENTATION_ANNOTATION_CUT_MERGE_PROCESS_COMPLETED,
  ]);

  window.services = servicesManager.services;
  window.extensionManager = extensionManager;
  window.commandsManager = commandsManager;

  if (appConfig.showCPUFallbackMessage && cornerstone.getShouldUseCPURendering()) {
    _showCPURenderingModal(uiModalService, hangingProtocolService);
  }
  const { getPresentationId: getLutPresentationId } = useLutPresentationStore.getState();

  const { getPresentationId: getSegmentationPresentationId } =
    useSegmentationPresentationStore.getState();

  const { getPresentationId: getPositionPresentationId } = usePositionPresentationStore.getState();

  // register presentation id providers
  viewportGridService.addPresentationIdProvider(
    'positionPresentationId',
    getPositionPresentationId
  );
  viewportGridService.addPresentationIdProvider('lutPresentationId', getLutPresentationId);
  viewportGridService.addPresentationIdProvider(
    'segmentationPresentationId',
    getSegmentationPresentationId
  );

  segmentationService.setStyle(
    { type: SegmentationRepresentations.Contour },
    {
      // Declare these alpha values at the Contour type level so that they can be set/changed/inherited for all contour segmentations.
      fillAlpha: 0.5,
      fillAlphaInactive: 0.4,

      // In general do not fill contours so that hydrated RTSTRUCTs are not filled in when active or inactive by default.
      // However, hydrated RTSTRUCTs are filled in when active or inactive if the user chooses to fill ALL contours.
      // Those Contours created in OHIF (i.e. using the Segmentation Panel) will override both fill properties upon creation.
      renderFill: false,
      renderFillInactive: false,
    }
  );

  const metadataProvider = OHIF.classes.MetadataProvider;

  volumeLoader.registerVolumeLoader(
    'cornerstoneStreamingImageVolume',
    cornerstoneStreamingImageVolumeLoader
  );

  volumeLoader.registerVolumeLoader(
    'cornerstoneStreamingDynamicImageVolume',
    cornerstoneStreamingDynamicImageVolumeLoader
  );

  // Register strategies using the wrapper
  const imageLoadStrategies = {
    interleaveCenter: interleaveCenterLoader,
    centerSequential: centerSequentialLoader,
    interleaveTopToBottom: interleaveTopToBottom,
    nth: nthLoader,
  };

  Object.entries(imageLoadStrategies).forEach(([name, strategyFn]) => {
    hangingProtocolService.registerImageLoadStrategy(
      name,
      createMetadataWrappedStrategy(strategyFn)
    );
  });

  // These are set reasonably low to allow for interleaved retrieves and slower
  // connections.
  imageLoadPoolManager.maxNumRequests = {
    [RequestTypes.Interaction]: appConfig?.maxNumRequests?.interaction || 10,
    [RequestTypes.Thumbnail]: appConfig?.maxNumRequests?.thumbnail || 5,
    [RequestTypes.Prefetch]: appConfig?.maxNumRequests?.prefetch || 5,
    [RequestTypes.Compute]: appConfig?.maxNumRequests?.compute || 10,
  };

  initWADOImageLoader(userAuthenticationService, appConfig, extensionManager);

  // Add OHIF metadata providers after dicomImageLoader.init().
  // The linked metadata branch clears providers during loader init.
  metaData.addProvider(csUtilities.genericMetadataProvider.get, 9998);
  metaData.addProvider(
    csUtilities.calibratedPixelSpacingMetadataProvider.get.bind(
      csUtilities.calibratedPixelSpacingMetadataProvider
    )
  ); // this provider is required for Calibration tool
  metaData.addProvider(metadataProvider.get.bind(metadataProvider), 9999);

  /* Measurement Service */
  this.measurementServiceSource = connectToolsToMeasurementService({
    servicesManager,
    commandsManager,
    extensionManager,
  });

  initCineService(servicesManager);
  initStudyPrefetcherService(servicesManager);

  measurementService.subscribe(measurementService.EVENTS.JUMP_TO_MEASUREMENT, evt => {
    const { measurement } = evt;
    const { uid: annotationUID } = measurement;
    commandsManager.runCommand('jumpToMeasurementViewport', { measurement, annotationUID, evt });
  });

  // When a custom image load is performed, update the relevant viewports
  hangingProtocolService.subscribe(
    hangingProtocolService.EVENTS.CUSTOM_IMAGE_LOAD_PERFORMED,
    volumeInputArrayMap => {
      const { lutPresentationStore } = useLutPresentationStore.getState();
      const { segmentationPresentationStore } = useSegmentationPresentationStore.getState();
      const { positionPresentationStore } = usePositionPresentationStore.getState();

      for (const entry of volumeInputArrayMap.entries()) {
        const [viewportId, volumeInputArray] = entry;
        const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

        const ohifViewport = cornerstoneViewportService.getViewportInfo(viewportId);

        const { presentationIds } = ohifViewport.getViewportOptions();

        const presentations = {
          positionPresentation: positionPresentationStore[presentationIds?.positionPresentationId],
          lutPresentation: lutPresentationStore[presentationIds?.lutPresentationId],
          segmentationPresentation:
            segmentationPresentationStore[presentationIds?.segmentationPresentationId],
        };

        cornerstoneViewportService.setVolumesForViewport(viewport, volumeInputArray, presentations);
      }
    }
  );

  initContextMenu({
    cornerstoneViewportService,
    customizationService,
    commandsManager,
  });

  initDoubleClick({
    customizationService,
    commandsManager,
  });

  /**
   * Runs error handler for failed requests.
   * @param event
   */
  const imageLoadFailedHandler = ({ detail }) => {
    const handler = errorHandler.getHTTPErrorHandler();
    handler(detail.error);
  };

  eventTarget.addEventListener(EVENTS.IMAGE_LOAD_FAILED, imageLoadFailedHandler);
  eventTarget.addEventListener(EVENTS.IMAGE_LOAD_ERROR, imageLoadFailedHandler);

  const getDisplaySetFromVolumeId = (volumeId: string) => {
    const allDisplaySets = displaySetService.getActiveDisplaySets();
    const volume = cornerstone.cache.getVolume(volumeId);
    const imageIds = volume.imageIds;
    return allDisplaySets.find(ds => ds.imageIds?.some(id => imageIds.includes(id)));
  };

  function elementEnabledHandler(evt) {
    const { element } = evt.detail;
    const { viewport } = getEnabledElement(element);
    initViewTiming({ element });

    element.addEventListener(EVENTS.CAMERA_RESET, evt => {
      const { element } = evt.detail;
      const enabledElement = getEnabledElement(element);
      if (!enabledElement) {
        return;
      }
      const { viewportId } = enabledElement;
      commandsManager.runCommand('resetCrosshairs', { viewportId });
    });

    // limitation: currently supporting only volume viewports with fusion
    if (viewport.type !== cornerstone.Enums.ViewportType.ORTHOGRAPHIC) {
      return;
    }
  }

  eventTarget.addEventListener(EVENTS.ELEMENT_ENABLED, elementEnabledHandler.bind(null));

  colormaps.forEach(registerColormap);

  // Event listener
  eventTarget.addEventListenerDebounced(
    EVENTS.ERROR_EVENT,
    ({ detail }) => {
      // Create a stable ID for deduplication based on error type and message
      const errorId = `cornerstone-error-${detail.type}-${detail.message.substring(0, 50)}`;

      uiNotificationService.show({
        title: detail.type,
        message: detail.message,
        type: 'error',
        id: errorId,
        allowDuplicates: false, // Prevent duplicate error notifications
        deduplicationInterval: 30000, // 30 seconds deduplication window
      });
    },
    100
  );

  // Subscribe to actor events to dynamically update colorbars

  // Call this function when initializing
  initializeWebWorkerProgressHandler(servicesManager.services.uiNotificationService);
}

/**
 * Creates a wrapped image load strategy with metadata handling
 * @param strategyFn - The image loading strategy function to wrap
 * @returns A wrapped strategy function that handles metadata configuration
 */
const createMetadataWrappedStrategy = (strategyFn: (args: any) => any) => {
  return (args: any) => {
    const clonedConfig = imageRetrieveMetadataProvider.clone();
    imageRetrieveMetadataProvider.clear();

    try {
      const result = strategyFn(args);
      return result;
    } finally {
      // Ensure metadata is always restored, even if there's an error
      setTimeout(() => {
        imageRetrieveMetadataProvider.restore(clonedConfig);
      }, 10);
    }
  };
};

function CPUModal() {
  return (
    <div>
      <p>
        Your computer does not have enough GPU power to support the default GPU rendering mode. OHIF
        has switched to CPU rendering mode. Please note that CPU rendering does not support all
        features such as Volume Rendering, Multiplanar Reconstruction, and Segmentation Overlays.
      </p>
    </div>
  );
}

function _showCPURenderingModal(uiModalService, hangingProtocolService) {
  const callback = progress => {
    if (progress === 100) {
      uiModalService.show({
        content: CPUModal,
        title: 'OHIF Fell Back to CPU Rendering',
      });

      return true;
    }
  };

  const { unsubscribe } = hangingProtocolService.subscribe(
    hangingProtocolService.EVENTS.PROTOCOL_CHANGED,
    () => {
      const done = callback(100);

      if (done) {
        unsubscribe();
      }
    }
  );
}
