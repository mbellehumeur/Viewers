import { UltrasoundPleuraBLineTool, Enums as csToolsEnums } from '@cornerstonejs/tools';
import { Types as OhifTypes, utils } from '@ohif/core';
import { eventTarget, triggerEvent } from '@cornerstonejs/core';
import getInstanceByImageId from './getInstanceByImageId';
import { setShowPercentage } from './PleuraBlinePercentage';
import { US_ANNOTATION_EVENTS } from './events';
import {
  parseUSAnnotationJson,
  serializeFrameAnnotations,
  filterFramesByRater,
  normalizeRaterName,
  type FrameAnnotation,
} from './utils/usAnnotationJson';
import { applyUSAnnotationToViewport } from './utils/applyUSAnnotationToViewport';
import { syncViewportToMergedFrames } from './utils/syncViewportToMergedFrames';
import { getUSAnnotationStoreState } from './stores/useUSAnnotationStore';

const { downloadBlob } = utils;

/**
 * Creates and returns the commands module for ultrasound annotation
 * @param params - Extension parameters including servicesManager and commandsManager
 * @returns The commands module with actions and definitions
 */
function commandsModule({
  servicesManager,
  commandsManager,
}: OhifTypes.Extensions.ExtensionParams): OhifTypes.Extensions.CommandsModule {
  const { viewportGridService, toolGroupService, cornerstoneViewportService, toolbarService } =
    servicesManager.services as AppTypes.Services;

  const activateUSPleuraBLineTool = (viewportId?: string) => {
    const activeViewportId = viewportId ?? viewportGridService.getActiveViewportId();
    const toolGroup = toolGroupService.getToolGroupForViewport(activeViewportId);

    if (!toolGroup?.hasTool(UltrasoundPleuraBLineTool.toolName)) {
      return false;
    }

    const activeToolName = toolGroup.getActivePrimaryMouseButtonTool();

    if (activeToolName) {
      const activeToolOptions = toolGroup.getToolConfiguration(activeToolName);
      activeToolOptions?.disableOnPassive
        ? toolGroup.setToolDisabled(activeToolName)
        : toolGroup.setToolPassive(activeToolName);
    }

    toolGroup.setToolActive(UltrasoundPleuraBLineTool.toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],
    });

    toolbarService.refreshToolbarState({
      viewportId: activeViewportId,
      toolGroupId: toolGroup.id,
    });

    return true;
  };

  const refreshViewportForSelectedRater = () => {
    const store = getUSAnnotationStoreState();
    const selectedRater = store.selectedRater;
    if (!selectedRater) {
      return { added: 0, skipped: 0 };
    }

    const activeViewportId = viewportGridService.getActiveViewportId();
    const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
    if (!viewport) {
      return { added: 0, skipped: 0 };
    }

    const frames = filterFramesByRater(store.getMergedFrames(), selectedRater);
    return applyUSAnnotationToViewport(viewport, frames, {
      rater: selectedRater,
      clearExisting: true,
    });
  };

  const applyFanGeometryFromParsed = parsed => {
    const activeViewportId = viewportGridService.getActiveViewportId();
    const toolGroup = toolGroupService.getToolGroupForViewport(activeViewportId);
    const usAnnotation = toolGroup?.getToolInstance(UltrasoundPleuraBLineTool.toolName);

    if (
      usAnnotation &&
      parsed.center_rows_px !== undefined &&
      parsed.center_cols_px !== undefined &&
      parsed.angle1 !== undefined &&
      parsed.angle2 !== undefined &&
      parsed.radius1 !== undefined &&
      parsed.radius2 !== undefined
    ) {
      usAnnotation.updateFanGeometryConfiguration({
        center: [parsed.center_cols_px, parsed.center_rows_px],
        startAngle: Math.min(parsed.angle1, parsed.angle2),
        endAngle: Math.max(parsed.angle1, parsed.angle2),
        innerRadius: parsed.radius1,
        outerRadius: parsed.radius2,
      });
      const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
      viewport?.render();
    }
  };

  const actions = {
    /**
     * Switches the active ultrasound annotation type
     * @param options - Object containing the annotationType to switch to
     */
    switchUSPleuraBLineAnnotation: ({ annotationType }) => {
      const activeViewportId = viewportGridService.getActiveViewportId();
      const activated = activateUSPleuraBLineTool(activeViewportId);

      if (!activated) {
        commandsManager.runCommand(
          'setToolActiveToolbar',
          { toolName: UltrasoundPleuraBLineTool.toolName },
          'CORNERSTONE'
        );
      }

      const toolGroup = toolGroupService.getToolGroupForViewport(activeViewportId);
      if (!toolGroup) {
        return;
      }
      const usAnnotation = toolGroup.getToolInstance(UltrasoundPleuraBLineTool.toolName);
      if (usAnnotation) {
        usAnnotation.setActiveAnnotationType(annotationType);
        triggerEvent(eventTarget, US_ANNOTATION_EVENTS.ANNOTATION_TYPE_CHANGED, {
          annotationType,
          viewportId: activeViewportId,
        });
      }
    },
    /**
     * Convenience method to switch to pleura line annotation type
     */
    switchUSPleuraBLineAnnotationToPleuraLine: () => {
      actions.switchUSPleuraBLineAnnotation({
        annotationType: UltrasoundPleuraBLineTool.USPleuraBLineAnnotationType.PLEURA,
      });
    },
    /**
     * Convenience method to switch to B-line annotation type
     */
    switchUSPleuraBLineAnnotationToBLine: () => {
      actions.switchUSPleuraBLineAnnotation({
        annotationType: UltrasoundPleuraBLineTool.USPleuraBLineAnnotationType.BLINE,
      });
    },
    /**
     * Deletes the last annotation of the specified type
     * @param options - Object containing the annotationType to delete
     */
    deleteLastUSPleuraBLineAnnotation: ({ annotationType }) => {
      const activeViewportId = viewportGridService.getActiveViewportId();
      const toolGroup = toolGroupService.getToolGroupForViewport(activeViewportId);
      if (!toolGroup) {
        return;
      }
      const usAnnotation = toolGroup.getToolInstance(UltrasoundPleuraBLineTool.toolName);
      if (usAnnotation) {
        const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
        usAnnotation.deleteLastAnnotationType(viewport.element, annotationType);
        viewport.render();
      }
    },

    /**
     * Convenience method to delete the last pleura line annotation
     */
    deleteLastPleuraAnnotation: () => {
      actions.deleteLastUSPleuraBLineAnnotation({
        annotationType: UltrasoundPleuraBLineTool.USPleuraBLineAnnotationType.PLEURA,
      });
    },
    /**
     * Convenience method to delete the last B-line annotation
     */
    deleteLastBLineAnnotation: () => {
      actions.deleteLastUSPleuraBLineAnnotation({
        annotationType: UltrasoundPleuraBLineTool.USPleuraBLineAnnotationType.BLINE,
      });
    },
    /**
     * Toggles a boolean attribute of the ultrasound annotation tool
     * @param options - Object containing the attribute name to toggle
     */
    toggleUSToolAttribute: ({ attribute }) => {
      const activeViewportId = viewportGridService.getActiveViewportId();
      const toolGroup = toolGroupService.getToolGroupForViewport(activeViewportId);
      if (!toolGroup) {
        return;
      }
      const configuration = toolGroup.getToolConfiguration(UltrasoundPleuraBLineTool.toolName);
      if (!configuration) {
        return;
      }
      toolGroup.setToolConfiguration(UltrasoundPleuraBLineTool.toolName, {
        [attribute]: !configuration[attribute],
      });
      const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
      viewport.render();
    },
    /**
     * Sets a specific attribute of the ultrasound annotation tool to a given value
     * @param options - Object containing the attribute name and value to set
     */
    setUSToolAttribute: ({ attribute, value }) => {
      const activeViewportId = viewportGridService.getActiveViewportId();
      const toolGroup = toolGroupService.getToolGroupForViewport(activeViewportId);
      if (!toolGroup) {
        return;
      }
      const configuration = toolGroup.getToolConfiguration(UltrasoundPleuraBLineTool.toolName);
      if (!configuration) {
        return;
      }
      toolGroup.setToolConfiguration(UltrasoundPleuraBLineTool.toolName, {
        [attribute]: value,
      });
      const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
      viewport.render();
    },
    /**
     * Toggles the display of fan annotations
     */
    toggleDisplayFanAnnotation: () => {
      actions.toggleUSToolAttribute({
        attribute: 'showFanAnnotations',
      });
    },
    /**
     * Toggles the display of the depth guide
     */
    toggleDepthGuide: () => {
      actions.toggleUSToolAttribute({
        attribute: 'drawDepthGuide',
      });
    },
    /**
     * Sets the depth guide display state
     * @param options - Object containing the boolean value to set
     */
    setDepthGuide: ({ value }) => {
      actions.setUSToolAttribute({
        attribute: 'drawDepthGuide',
        value,
      });
    },
    /**
     * Sets the fan annotation display state
     * @param options - Object containing the boolean value to set
     */
    setDisplayFanAnnotation: ({ value }) => {
      actions.setUSToolAttribute({
        attribute: 'showFanAnnotations',
        value,
      });
    },
    /**
     * Sets whether to show the pleura percentage in the viewport overlay
     * @param options - Object containing the boolean value to set
     */
    setShowPleuraPercentage: ({ value }) => {
      setShowPercentage(value);
      // Trigger ANNOTATION_MODIFIED event to update the overlay
      triggerEvent(eventTarget, csToolsEnums.Events.ANNOTATION_MODIFIED, {
        annotation: {
          metadata: {
            toolName: UltrasoundPleuraBLineTool.toolName,
          },
        },
      });
    },
    /**
     * Generates a JSON representation of the ultrasound annotations
     * @param options - labels, imageIds, and optional rater for export
     * @returns A JSON object containing the annotations data or undefined if generation fails
     */
    generateUSPleuraBLineAnnotationsJSON: ({
      labels = [],
      imageIds = [],
      rater = '',
    }: { labels?: string[]; imageIds?: string[]; rater?: string } = {}) => {
      actions.syncUSAnnotationsToStore({ imageIds });

      const store = getUSAnnotationStoreState();
      const exportRater = normalizeRaterName(rater || store.selectedRater);
      if (!exportRater) {
        return;
      }

      const activeViewportId = viewportGridService.getActiveViewportId();
      const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
      if (!viewport) {
        return;
      }

      const toolGroup = toolGroupService.getToolGroupForViewport(activeViewportId);
      const configuration = toolGroup?.getToolConfiguration(UltrasoundPleuraBLineTool.toolName);
      const imageId = viewport.getCurrentImageId();
      const instance = getInstanceByImageId(servicesManager.services, imageId);
      const merged = store.merged;

      const filteredFrames = filterFramesByRater(store.getMergedFrames(), exportRater);
      const annotationLabels =
        labels.length > 0 ? labels : (merged?.AnnotationLabels ?? []);

      return serializeFrameAnnotations(
        filteredFrames,
        {
          SOPInstanceUID: merged?.SOPInstanceUID ?? instance?.SOPInstanceUID,
          GrayscaleConversion: merged?.GrayscaleConversion ?? false,
          mask_type: merged?.mask_type ?? 'fan',
          angle1: configuration?.startAngle ?? merged?.angle1,
          angle2: configuration?.endAngle ?? merged?.angle2,
          center_rows_px: configuration?.center?.[1] ?? merged?.center_rows_px,
          center_cols_px: configuration?.center?.[0] ?? merged?.center_cols_px,
          radius1: configuration?.innerRadius ?? merged?.radius1,
          radius2: configuration?.outerRadius ?? merged?.radius2,
          image_size_rows: merged?.image_size_rows ?? instance?.rows,
          image_size_cols: merged?.image_size_cols ?? instance?.columns,
        },
        { labels: annotationLabels, rater: exportRater }
      );
    },
    syncUSAnnotationsToStore: ({ imageIds = [] }: { imageIds?: string[] } = {}) => {
      const store = getUSAnnotationStoreState();
      if (!store.selectedRater) {
        return;
      }

      const activeViewportId = viewportGridService.getActiveViewportId();
      const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
      if (!viewport) {
        return;
      }

      const updated = syncViewportToMergedFrames(
        viewport,
        store.getMergedFrames(),
        store.selectedRater,
        imageIds
      );
      store.setMergedFrames(updated);
    },
    setUSAnnotationSelectedRater: ({
      rater,
      imageIds = [],
    }: {
      rater: string;
      imageIds?: string[];
    }) => {
      actions.syncUSAnnotationsToStore({ imageIds });
      getUSAnnotationStoreState().setSelectedRater(rater);
      return refreshViewportForSelectedRater();
    },
    refreshUSAnnotationViewportForSelectedRater: () => refreshViewportForSelectedRater(),
    /**
     * Parses imported US annotation JSON, optionally applies fan geometry,
     * and hydrates annotations onto the active viewport.
     */
    importUSAnnotationJSON: ({
      json,
      applyFanGeometry = false,
      applyToViewport = true,
    }: {
      json: unknown;
      applyFanGeometry?: boolean;
      applyToViewport?: boolean;
    }) => {
      const parsed = parseUSAnnotationJson(json);
      const store = getUSAnnotationStoreState();
      const { importedRaters } = store.mergeImport(parsed);

      if (applyFanGeometry) {
        applyFanGeometryFromParsed(parsed);
      }

      let hydrationResult = { added: 0, skipped: 0 };

      if (applyToViewport) {
        hydrationResult = refreshViewportForSelectedRater();
      }

      return {
        frameAnnotations: store.getMergedFrames(),
        raters: store.raters,
        selectedRater: store.selectedRater,
        importedRaters,
        annotationLabels: store.merged?.AnnotationLabels ?? [],
        labels: store.merged?.labels ?? [],
        metadata: {
          SOPInstanceUID: store.merged?.SOPInstanceUID,
          angle1: store.merged?.angle1,
          angle2: store.merged?.angle2,
          center_rows_px: store.merged?.center_rows_px,
          center_cols_px: store.merged?.center_cols_px,
          radius1: store.merged?.radius1,
          radius2: store.merged?.radius2,
        },
        hydration: hydrationResult,
      };
    },
    /**
     * Hydrates parsed frame annotations onto the active viewport as tool annotations.
     */
    applyUSAnnotationJSONToViewport: ({
      frameAnnotations,
      rater = '',
      clearExisting = true,
    }: {
      frameAnnotations: FrameAnnotation[];
      rater?: string;
      clearExisting?: boolean;
    }) => {
      const activeViewportId = viewportGridService.getActiveViewportId();
      const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
      if (!viewport) {
        return { added: 0, skipped: 0 };
      }
      const selectedRater = normalizeRaterName(rater || getUSAnnotationStoreState().selectedRater);
      const frames = selectedRater
        ? filterFramesByRater(frameAnnotations, selectedRater)
        : frameAnnotations;
      return applyUSAnnotationToViewport(viewport, frames, { rater: selectedRater, clearExisting });
    },
    /**
     * Downloads the ultrasound annotations as a JSON file
     * @param options - Object containing labels, imageIds, and rater
     */
    downloadUSPleuraBLineAnnotationsJSON({ labels = [], imageIds = [], rater = '' }) {
      const exportRater = normalizeRaterName(rater || getUSAnnotationStoreState().selectedRater);
      const json = actions.generateUSPleuraBLineAnnotationsJSON({ labels, imageIds, rater: exportRater });
      if (!json) {
        return;
      }

      const jsonString = JSON.stringify(json, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const filename = exportRater
        ? `ultrasound_annotations_${exportRater}_${new Date().toISOString().slice(0, 10)}.json`
        : `ultrasound_annotations_${new Date().toISOString().slice(0, 10)}.json`;
      downloadBlob(blob, { filename });
    },
  };

  const definitions = {
    switchUSAnnotation: {
      commandFn: actions.switchUSPleuraBLineAnnotation,
    },
    deleteLastAnnotation: {
      commandFn: actions.deleteLastUSPleuraBLineAnnotation,
    },
    toggleDepthGuide: {
      commandFn: actions.toggleDepthGuide,
    },
    setDepthGuide: {
      commandFn: actions.setDepthGuide,
    },
    setShowPleuraPercentage: {
      commandFn: actions.setShowPleuraPercentage,
    },
    toggleUSToolAttribute: {
      commandFn: actions.toggleUSToolAttribute,
    },
    setUSToolAttribute: {
      commandFn: actions.setUSToolAttribute,
    },
    toggleDisplayFanAnnotation: {
      commandFn: actions.toggleDisplayFanAnnotation,
    },
    setDisplayFanAnnotation: {
      commandFn: actions.setDisplayFanAnnotation,
    },
    generateJSON: {
      commandFn: actions.generateUSPleuraBLineAnnotationsJSON,
    },
    downloadJSON: {
      commandFn: actions.downloadUSPleuraBLineAnnotationsJSON,
    },
    importJSON: {
      commandFn: actions.importUSAnnotationJSON,
    },
    syncUSAnnotationsToStore: {
      commandFn: actions.syncUSAnnotationsToStore,
    },
    setUSAnnotationSelectedRater: {
      commandFn: actions.setUSAnnotationSelectedRater,
    },
    refreshUSAnnotationViewportForSelectedRater: {
      commandFn: actions.refreshUSAnnotationViewportForSelectedRater,
    },
    applyJSONToViewport: {
      commandFn: actions.applyUSAnnotationJSONToViewport,
    },
    switchUSAnnotationToPleuraLine: {
      commandFn: actions.switchUSPleuraBLineAnnotationToPleuraLine,
    },
    switchUSAnnotationToBLine: {
      commandFn: actions.switchUSPleuraBLineAnnotationToBLine,
    },
    deleteLastPleuraAnnotation: {
      commandFn: actions.deleteLastPleuraAnnotation,
    },
    deleteLastBLineAnnotation: {
      commandFn: actions.deleteLastBLineAnnotation,
    },
  };

  return {
    actions,
    definitions,
    defaultContext: 'CORNERSTONE',
  };
}

export default commandsModule;
