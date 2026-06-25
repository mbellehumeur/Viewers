import React, { useEffect, useRef, useState } from 'react';
import { Enums as csToolsEnums, UltrasoundPleuraBLineTool } from '@cornerstonejs/tools';
import { eventTarget, utilities } from '@cornerstonejs/core';
import { useSystem, HotkeysManager } from '@ohif/core';
import { useTranslation } from 'react-i18next';

import {
  /* Layout */
  PanelSection,
  /* Controls */
  Label,
  Button,
  Icons,
  Switch,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Tabs,
  TabsList,
  TabsTrigger,
  Separator,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ohif/ui-next';
import { US_ANNOTATION_EVENTS } from '../events';
import { toPanelRows, validateForViewport, type FrameAnnotation } from '../utils/usAnnotationJson';
import getInstanceByImageId from '../getInstanceByImageId';
import { useUSAnnotationStore } from '../stores/useUSAnnotationStore';

const EMPTY_FRAME_ANNOTATIONS: FrameAnnotation[] = [];

type AnnotatedFrameRow = {
  frame: number;
  pleura: number;
  bLine: number;
  index: number;
  imageId?: string;
};

/**
 * A side panel that drives the ultrasound annotation workflow.
 * It provides controls for managing annotations, toggling display options,
 * and downloading annotations as JSON.
 * @returns The USAnnotationPanel component
 */
export default function USAnnotationPanel() {
  const { t } = useTranslation('USAnnotationPanel');
  const { servicesManager, commandsManager, hotkeysManager } = useSystem();

  /** ──────────────────────────────────────────────────────
   * Local state – purely UI related (no business logic).   */

  const { viewportGridService, cornerstoneViewportService, measurementService, toolGroupService } =
    servicesManager.services as AppTypes.Services;

  // UI state variables
  const [depthGuide, setDepthGuide] = useState(true);
  const [autoAdd, setAutoAdd] = useState(true);
  const [showPleuraPct, setShowPleuraPct] = useState(true);
  const [showOverlay, setShowOverlay] = useState(true);
  const [activeAnnotationType, setActiveAnnotationType] = useState(
    UltrasoundPleuraBLineTool.USPleuraBLineAnnotationType.BLINE
  );

  // Data state variables
  const [annotatedFrames, setAnnotatedFrames] = useState<AnnotatedFrameRow[]>([]);
  const [imageIdsToObserve, setImageIdsToObserve] = useState<string[]>([]);
  const [newRaterName, setNewRaterName] = useState('');
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [tableMaxHeight, setTableMaxHeight] = useState(240);

  const updateTableScrollHeight = React.useCallback(() => {
    requestAnimationFrame(() => {
      const el = tableScrollRef.current;
      if (!el) {
        return;
      }
      const top = el.getBoundingClientRect().top;
      setTableMaxHeight(Math.max(120, window.innerHeight - top - 12));
    });
  }, []);

  const raters = useUSAnnotationStore(state => state.raters);
  const selectedRater = useUSAnnotationStore(state => state.selectedRater);
  const mergedFrames = useUSAnnotationStore(
    state => state.merged?.frame_annotations ?? EMPTY_FRAME_ANNOTATIONS
  );
  const selectedRaterValue =
    selectedRater && raters.includes(selectedRater) ? selectedRater : undefined;

  useEffect(() => {
    updateTableScrollHeight();
    const timeout = window.setTimeout(updateTableScrollHeight, 350);
    window.addEventListener('resize', updateTableScrollHeight);

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('resize', updateTableScrollHeight);
    };
  }, [updateTableScrollHeight, annotatedFrames.length, selectedRater, raters.length]);

  /** ──────────────────────────────────────────────────────
   * Helper – commands bridging back to OHIF services.       */

  /**
   * Switches the active annotation type (pleura or B-line)
   * @param type - The annotation type to switch to
   */
  const switchAnnotation = (type: string) => {
    setActiveAnnotationType(type);
    commandsManager.runCommand('switchUSAnnotation', { annotationType: type });
  };

  const readActiveAnnotationTypeFromTool = React.useCallback(() => {
    const activeViewportId = viewportGridService.getActiveViewportId();
    const toolGroup = toolGroupService.getToolGroupForViewport(activeViewportId);
    const usAnnotation = toolGroup?.getToolInstance(UltrasoundPleuraBLineTool.toolName);

    return usAnnotation?.getActiveAnnotationType() ?? null;
  }, [viewportGridService, toolGroupService]);

  /**
   * Deletes the last annotation of the specified type
   * @param type - The annotation type to delete
   */
  const deleteLast = (type: string) => {
    commandsManager.runCommand('deleteLastAnnotation', { annotationType: type });
    updateAnnotatedFrames();
  };

  /**
   * Sets the depth guide display state
   * @param value - Boolean indicating whether to show the depth guide
   */
  const setDepthGuideCommand = (value: boolean) => {
    commandsManager.runCommand('setDepthGuide', { value });
    setDepthGuide(value);
  };
  /**
   * Sets the auto-add annotations state
   * When enabled, all frames are monitored for annotations
   * When disabled, only manually added frames are monitored
   * @param value - Boolean indicating whether to auto-add annotations
   */
  const setAutoAddCommand = (value: boolean) => {
    if (value) {
      setImageIdsToObserve([]);
    } else {
      const imageIds = annotatedFrames.map(item => item.imageId);
      if (imageIds.length > 0) {
        setImageIdsToObserve(imageIds);
      } else {
        setImageIdsToObserve(['Manual']);
      }
    }
    setAutoAdd(value);
  };
  /**
   * Sets whether to show the pleura percentage in the viewport overlay
   * @param value - Boolean indicating whether to show the percentage
   */
  const setShowPleuraPercentageCommand = (value: boolean) => {
    commandsManager.runCommand('setShowPleuraPercentage', { value });
    setShowPleuraPct(value);
  };
  /**
   * Sets whether to show the fan overlay in the viewport
   * @param value - Boolean indicating whether to show the overlay
   */
  const setShowOverlayCommand = (value: boolean) => {
    commandsManager.runCommand('setDisplayFanAnnotation', { value });
    commandsManager.runCommand('setShowPleuraPercentage', { value });
    setShowOverlay(value);
  };
  /**
   * Downloads the annotations as a JSON file
   */
  const downloadJSON = () => {
    commandsManager.runCommand('downloadJSON', {
      imageIds: imageIdsToObserve,
      rater: selectedRater,
    });
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const result = commandsManager.runCommand('importJSON', {
        json,
        applyFanGeometry: true,
        applyToViewport: true,
      });

      if (!result) {
        return;
      }

      updateAnnotatedFrames();

      const activeViewportId = viewportGridService.getActiveViewportId();
      const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
      const imageId = viewport?.getCurrentImageId();
      const instance = imageId
        ? getInstanceByImageId(servicesManager.services, imageId)
        : undefined;
      const warnings = validateForViewport(
        {
          frame_annotations: result.frameAnnotations,
          SOPInstanceUID: result.metadata?.SOPInstanceUID,
        },
        instance?.SOPInstanceUID
      );
      setImportWarning(warnings.length > 0 ? t('SOPInstanceUID mismatch warning') : null);
    } catch {
      setImportWarning(t('Import JSON error'));
    }
  };

  const handleRaterChange = (value: string) => {
    commandsManager.runCommand('setUSAnnotationSelectedRater', {
      rater: value,
      imageIds: imageIdsToObserve,
    });
    updateAnnotatedFrames();
  };

  const handleAddRater = () => {
    const name = newRaterName.trim();
    if (!name) {
      return;
    }
    useUSAnnotationStore.getState().addRater(name);
    setNewRaterName('');
    handleRaterChange(useUSAnnotationStore.getState().selectedRater);
  };
  const addCurrentImageId = () => {
    if (!autoAdd) {
      const activeViewportId = viewportGridService.getActiveViewportId();
      const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
      const currentImageId = viewport.getCurrentImageId();
      const imageIds = [...imageIdsToObserve];
      if (!imageIds.includes(currentImageId)) {
        imageIds.push(currentImageId);
      }
      setImageIdsToObserve(imageIds);
    }
  };

  /**
   * Handles clicking on a row in the annotated frames table
   * Scrolls the viewport to the selected frame
   * @param item - The annotated frame item that was clicked
   */
  const handleRowClick = item => {
    const activeViewportId = viewportGridService.getActiveViewportId();
    const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
    utilities.scroll(viewport, { delta: item.frame - viewport.getCurrentImageIdIndex() });
  };

  /**
   * Render helpers so the JSX doesn’t become spaghetti.     */
  const renderWorkflowToggles = () => (
    <PanelSection.Content>
      <div className="text-foreground space-y-3 p-2 text-sm">
        <div className="flex items-center">
          <Switch
            id="depth-guide-switch"
            className="mr-3"
            checked={depthGuide}
            onCheckedChange={() => setDepthGuideCommand(!depthGuide)}
          />
          <label
            htmlFor="depth-guide-switch"
            className="cursor-pointer"
            onClick={() => setDepthGuideCommand(!depthGuide)}
          >
            {t('Depth guide toggle')}
          </label>
        </div>

        {/* <div className="flex items-center">
          <Switch
            id="auto-add-switch"
            className="mr-3"
            checked={autoAdd}
            onCheckedChange={() => setAutoAddCommand(!autoAdd)}
          />
          <label
            htmlFor="auto-add-switch"
            className="cursor-pointer"
            onClick={() => setAutoAddCommand(!autoAdd)}
          >
            Auto-add annotations
          </label>
        </div> */}

        <div className="flex items-center">
          <Switch
            id="pleura-percentage-switch"
            className="mr-3"
            checked={showPleuraPct}
            onCheckedChange={() => setShowPleuraPercentageCommand(!showPleuraPct)}
          />
          <label
            htmlFor="pleura-percentage-switch"
            className="cursor-pointer"
            onClick={() => setShowPleuraPercentageCommand(!showPleuraPct)}
          >
            {t('Show pleura percentage')}
          </label>
        </div>

        <div className="flex items-center">
          <Switch
            id="show-overlay-switch"
            className="mr-3"
            checked={showOverlay}
            onCheckedChange={() => setShowOverlayCommand(!showOverlay)}
          />
          <label
            htmlFor="show-overlay-switch"
            className="cursor-pointer"
            onClick={() => setShowOverlayCommand(!showOverlay)}
          >
            {t('Show Overlay')}
          </label>
        </div>

        <div className="flex items-center gap-1 pt-1">
          <Button variant="ghost" onClick={() => downloadJSON()}>
            <Icons.Download className="h-5 w-5" />
            <span>{t('JSON')}</span>
          </Button>
          <Button variant="ghost" onClick={handleImportClick}>
            <Icons.Upload className="h-5 w-5" />
            <span>{t('Import JSON')}</span>
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
        {importWarning && <p className="text-destructive text-xs">{importWarning}</p>}
      </div>
    </PanelSection.Content>
  );

  const renderAnnotatedFrames = () => (
    <PanelSection.Content>
      <div className="space-y-3 px-2 pb-2">
        <div>
          <Label className="mb-1 block">{t('Rater')}</Label>
          <Select value={selectedRaterValue} onValueChange={handleRaterChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('Select rater')} />
            </SelectTrigger>
            <SelectContent>
              {raters.map(raterName => (
                <SelectItem key={raterName} value={raterName}>
                  {raterName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="mt-2 flex gap-2">
            <Input
              value={newRaterName}
              onChange={e => setNewRaterName(e.target.value)}
              placeholder={t('New rater name')}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  handleAddRater();
                }
              }}
            />
            <Button variant="outline" onClick={handleAddRater}>
              {t('Add')}
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Tabs value={activeAnnotationType} onValueChange={switchAnnotation}>
            <TabsList>
              <TabsTrigger value={UltrasoundPleuraBLineTool.USPleuraBLineAnnotationType.PLEURA}>
                <Icons.Plus /> {t('Pleura line')}
              </TabsTrigger>
              <TabsTrigger value={UltrasoundPleuraBLineTool.USPleuraBLineAnnotationType.BLINE}>
                <Icons.Plus /> {t('B-line')}
              </TabsTrigger>
              <Separator orientation="vertical" />
              <Separator orientation="vertical" />
            </TabsList>
          </Tabs>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="ml-auto">
                <Icons.More />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onClick={() =>
                  deleteLast(UltrasoundPleuraBLineTool.USPleuraBLineAnnotationType.BLINE)
                }
              >
                <Icons.Delete className="text-foreground" />
                <span className="pl-2">{t('B-line annotation')}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  deleteLast(UltrasoundPleuraBLineTool.USPleuraBLineAnnotationType.PLEURA)
                }
              >
                <Icons.Delete className="text-foreground" />
                <span className="pl-2">{t('Pleura annotation')}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div
        ref={tableScrollRef}
        className="ohif-scrollbar ohif-scrollbar-stable-gutter overflow-y-auto px-2 pb-2"
        style={{ maxHeight: tableMaxHeight }}
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-muted-foreground border-input/50 bg-background sticky top-0 z-10 border-b">
              <th className="py-2 px-2 text-left font-normal">{t('Frame')}</th>
              <th className="py-2 px-2 text-center font-normal">{t('Pleura lines')}</th>
              <th className="py-2 px-2 text-center font-normal">{t('B-lines')}</th>
            </tr>
          </thead>
          <tbody>
            {annotatedFrames.map(item => (
              <tr
                key={item.frame}
                className="border-input/50 border-b"
                onClick={() => handleRowClick(item)}
                style={{ cursor: 'pointer' }}
              >
                <td className="py-2 px-2">{item.frame + 1}</td>
                <td className="py-2 px-2 text-center">{item.pleura}</td>
                <td className="py-2 px-2 text-center">{item.bLine}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelSection.Content>
  );

  const getLivePanelRows = React.useCallback((): AnnotatedFrameRow[] => {
    const activeViewportId = viewportGridService.getActiveViewportId();
    const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
    if (!viewport) {
      return [];
    }

    const imageIdsMonitored = [...imageIdsToObserve];
    const imageIdFilter = (imageId: string) => {
      if (imageIdsMonitored.length === 0) {
        return true;
      }
      return imageIdsMonitored.includes(imageId);
    };
    const mapping = UltrasoundPleuraBLineTool.countAnnotations(viewport.element, imageIdFilter);
    if (!mapping) {
      return [];
    }

    return Array.from(mapping.keys()).map((key, index) => {
      const { pleura, bLine, frame } = mapping.get(key) || { pleura: 0, bLine: 0, frame: 0 };
      return { imageId: key, index: index + 1, frame, pleura, bLine };
    });
  }, [viewportGridService, cornerstoneViewportService, imageIdsToObserve]);

  const updateAnnotatedFrames = React.useCallback(() => {
    const { merged, selectedRater: rater } = useUSAnnotationStore.getState();
    const frames = merged?.frame_annotations;
    if (frames?.length && rater) {
      setAnnotatedFrames(toPanelRows(frames, 'imported', rater));
      return;
    }

    setAnnotatedFrames(getLivePanelRows());
  }, [getLivePanelRows]);
  /**
   * Callback function that is called when an annotation is modified
   * Updates the annotatedFrames state with the latest annotation data
   */
  const annotationModified = React.useCallback(
    event => {
      const annotation = event?.detail?.annotation;
      if (annotation?.metadata?.toolName !== UltrasoundPleuraBLineTool.toolName) {
        return;
      }

      commandsManager.runCommand('syncUSAnnotationsToStore', {
        imageIds: imageIdsToObserve,
      });
      updateAnnotatedFrames();
    },
    [commandsManager, imageIdsToObserve, updateAnnotatedFrames]
  );

  useEffect(() => {
    const type = readActiveAnnotationTypeFromTool();
    if (type) {
      setActiveAnnotationType(type);
    }
  }, [readActiveAnnotationTypeFromTool]);

  useEffect(() => {
    updateAnnotatedFrames();
  }, [updateAnnotatedFrames, mergedFrames, selectedRater]);

  useEffect(() => {
    const { unsubscribe } = viewportGridService.subscribe(
      viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
      () => {
        const type = readActiveAnnotationTypeFromTool();
        if (type) {
          setActiveAnnotationType(type);
        }
        updateAnnotatedFrames();
      }
    );

    return () => {
      unsubscribe();
    };
  }, [viewportGridService, readActiveAnnotationTypeFromTool, updateAnnotatedFrames]);

  useEffect(() => {
    const onAnnotationTypeChanged = (event: Event) => {
      const { annotationType } = (event as CustomEvent<{ annotationType: string }>).detail ?? {};
      if (annotationType) {
        setActiveAnnotationType(annotationType);
      }
    };

    eventTarget.addEventListener(
      US_ANNOTATION_EVENTS.ANNOTATION_TYPE_CHANGED,
      onAnnotationTypeChanged
    );

    return () => {
      eventTarget.removeEventListener(
        US_ANNOTATION_EVENTS.ANNOTATION_TYPE_CHANGED,
        onAnnotationTypeChanged
      );
    };
  }, []);

  useEffect(() => {
    const { unsubscribe } = hotkeysManager.subscribe(
      HotkeysManager.EVENTS.HOTKEY_PRESSED,
      ({ commandName }: { commandName: string }) => {
        if (commandName === 'switchUSAnnotationToPleuraLine') {
          setActiveAnnotationType(UltrasoundPleuraBLineTool.USPleuraBLineAnnotationType.PLEURA);
        } else if (commandName === 'switchUSAnnotationToBLine') {
          setActiveAnnotationType(UltrasoundPleuraBLineTool.USPleuraBLineAnnotationType.BLINE);
        }
      }
    );

    return () => {
      unsubscribe();
    };
  }, [hotkeysManager]);

  useEffect(() => {
    eventTarget.addEventListener(csToolsEnums.Events.ANNOTATION_MODIFIED, annotationModified);
    const { unsubscribe } = measurementService.subscribe(
      measurementService.EVENTS.MEASUREMENT_REMOVED,
      () => {
        updateAnnotatedFrames();
      }
    );

    return () => {
      eventTarget.removeEventListener(csToolsEnums.Events.ANNOTATION_MODIFIED, annotationModified);
      unsubscribe();
    };
  }, [annotationModified, measurementService]);

  /**
   * ──────────────────────────────────────────────────────
   *  🖼  Final Render                                      */
  return (
    <div
      className="text-foreground flex h-full min-h-0 flex-col bg-background"
      style={{ minWidth: 240, maxWidth: 480, width: '100%' }}
    >
      {/* Workflow */}
      <PanelSection className="flex-shrink-0">
        <PanelSection.Header>{t('Workflow')}</PanelSection.Header>
        {renderWorkflowToggles()}
      </PanelSection>

      {/* Progress
      <PanelSection>
        <SectionHeader title="Workflow Progress" actionLabel="Source Folder" />
        {renderWorkflowProgress()}
      </PanelSection> */}

      {/* Annotated frames */}
      <PanelSection className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelSection.Header>{t('Annotated Frames')}</PanelSection.Header>
        {renderAnnotatedFrames()}
      </PanelSection>
    </div>
  );
}
