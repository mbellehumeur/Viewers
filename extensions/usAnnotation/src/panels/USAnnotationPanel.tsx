import React, { useEffect, useState } from 'react';
import { Enums as csToolsEnums, UltrasoundPleuraBLineTool } from '@cornerstonejs/tools';
import { eventTarget, utilities } from '@cornerstonejs/core';
import { useSystem } from '@ohif/core';
import { useTranslation } from 'react-i18next';

import {
  /* Layout */
  PanelSection,
  ScrollArea,
  /* Controls */
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
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  Input,
} from '@ohif/ui-next';

import ClipLevelLabels from './ClipLevelLabels';
import { subscribeCastTopic } from '../castTopic';

/**
 * A side panel that drives the ultrasound annotation workflow.
 * It provides controls for managing annotations, toggling display options,
 * and downloading annotations as JSON.
 * @returns The USAnnotationPanel component
 */
export default function USAnnotationPanel() {
  const { t } = useTranslation('USAnnotationPanel');
  const { servicesManager, commandsManager } = useSystem();

  /** ──────────────────────────────────────────────────────
   * Local state – purely UI related (no business logic).   */

  const { viewportGridService, cornerstoneViewportService, measurementService } =
    servicesManager.services as AppTypes.Services;

  const castService = (servicesManager.services as { castService?: unknown }).castService as
    | Parameters<typeof subscribeCastTopic>[0]
    | undefined;

  // UI state variables
  const [depthGuide, setDepthGuide] = useState(true);
  const [showPleuraPct, setShowPleuraPct] = useState(true);
  const [showOverlay, setShowOverlay] = useState(true);
  const [rater, setRater] = useState('');

  // Data state variables
  const [annotatedFrames, setAnnotatedFrames] = useState<any[]>([]);
  const [imageIdsToObserve, setImageIdsToObserve] = useState<string[]>([]);
  const [clipLabels, setClipLabels] = useState<string[]>([]);

  useEffect(() => {
    return subscribeCastTopic(castService, topic => {
      if (topic) {
        setRater(topic);
      }
    });
  }, [castService]);

  /** ──────────────────────────────────────────────────────
   * Helper – commands bridging back to OHIF services.       */

  /**
   * Switches the active annotation type (pleura or B-line)
   * @param type - The annotation type to switch to
   */
  const switchAnnotation = (type: string) => {
    commandsManager.runCommand('setToolActive', { toolName: UltrasoundPleuraBLineTool.toolName });
    commandsManager.runCommand('switchUSAnnotation', { annotationType: type });
  };

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
   * Sets whether to show the pleura percentage in the viewport overlay
   * @param value - Boolean indicating whether to show the percentage
   */
  const setShowPleuraPercentageCommand = (value: boolean) => {
    commandsManager.runCommand('setShowPleuraPercentage', { value });
    setShowPleuraPct(value);
  };
  const setShowOverlayCommand = (value: boolean) => {
    commandsManager.runCommand('setDisplayFanAnnotation', { value });
    commandsManager.runCommand('setShowPleuraPercentage', { value });
    setShowOverlay(value);
    setShowPleuraPct(value);
  };
  const toggleShowOverlay = () => {
    setShowOverlayCommand(!showOverlay);
  };
  /**
   * Downloads the annotations as a JSON file
   */
  const downloadJSON = () => {
    commandsManager.runCommand('downloadJSON', {
      labels: clipLabels,
      imageIds: imageIdsToObserve,
      rater,
    });
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

  const renderRater = () => (
    <PanelSection.Content>
      <div className="flex items-center gap-2 p-2">
        <Input
          id="us-annotation-rater"
          className="h-8 min-w-0 flex-1 text-sm"
          value={rater}
          onChange={event => setRater(event.target.value)}
          placeholder={t('Rater')}
        />
        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => downloadJSON()}>
          <Icons.Download className="h-4 w-4" />
          <span>{t('JSON')}</span>
        </Button>
      </div>
    </PanelSection.Content>
  );

  const renderSettingsToggles = () => (
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
      </div>
    </PanelSection.Content>
  );

  const renderSectorAnnotations = () => (
    <PanelSection.Content>
      <div className="p-2">
        <div className="flex items-center gap-2">
          <Tabs
            defaultValue={UltrasoundPleuraBLineTool.USPleuraBLineAnnotationType.BLINE}
            onValueChange={newValue => switchAnnotation(newValue)}
          >
            <TabsList>
              <TabsTrigger value={UltrasoundPleuraBLineTool.USPleuraBLineAnnotationType.PLEURA}>
                <Icons.Plus /> {t('Pleura line')}
              </TabsTrigger>
              <TabsTrigger value={UltrasoundPleuraBLineTool.USPleuraBLineAnnotationType.BLINE}>
                <Icons.Plus /> {t('B-line')}
              </TabsTrigger>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2"
                    onClick={toggleShowOverlay}
                    aria-label={t('Show Overlay')}
                    aria-pressed={showOverlay}
                  >
                    {showOverlay ? (
                      <Icons.EyeVisible className="h-4 w-4" />
                    ) : (
                      <Icons.Hide className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('Show Overlay')}</TooltipContent>
              </Tooltip>
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
    </PanelSection.Content>
  );

  const renderAnnotatedFrames = () => (
    <ScrollArea className="h-full">
      <PanelSection.Content>
        <div className="w-full overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-muted-foreground border-input/50 border-b">
                <th></th>
                <th className="py-2 px-2 text-left font-normal">{t('Frame')}</th>
                <th className="py-2 px-2 text-center font-normal">{t('Pleura lines')}</th>
                <th className="py-2 px-2 text-center font-normal">{t('B-lines')}</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {annotatedFrames.map(item => (
                <tr
                  key={item.frame}
                  className={`border-input/50 border-b ${
                    item.frame === 5 ? 'bg-cyan-800 bg-opacity-30' : ''
                  }`}
                  onClick={() => handleRowClick(item)}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="py-2 px-2">{item.index}</td>
                  <td className="py-2 px-2">{item.frame + 1}</td>
                  <td className="py-2 px-2 text-center">{item.pleura}</td>
                  <td className="py-2 px-2 text-center">{item.bLine}</td>
                  <td className="py-2 px-2 text-right">
                    {item.frame === 5 && (
                      <div className="flex items-center justify-end">
                        <Button variant="ghost" className="p-0">
                          <Icons.EyeVisible />
                        </Button>
                        <Button variant="ghost" className="ml-2 p-0">
                          <Icons.More />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelSection.Content>
    </ScrollArea>
  );

  const updateAnnotatedFrames = () => {
    const activeViewportId = viewportGridService.getActiveViewportId();
    const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
    const imageIdsMonitored = [...imageIdsToObserve];
    const imageIdFilter = (imageId: string) => {
      if (imageIdsMonitored.length === 0) {
        return true;
      }
      return imageIdsMonitored.includes(imageId);
    };
    const mapping = UltrasoundPleuraBLineTool.countAnnotations(viewport.element, imageIdFilter);
    if (!mapping) {
      setAnnotatedFrames([]);
      return;
    }
    const keys = Array.from(mapping.keys());
    const updatedFrames = keys.map((key, index) => {
      const { pleura, bLine, frame } = mapping.get(key) || { pleura: 0, bLine: 0, frame: 0 };
      return { imageId: key, index: index + 1, frame, pleura, bLine };
    });
    setAnnotatedFrames(updatedFrames);
  };

  const annotationModified = React.useCallback(
    event => {
      if (event.detail.annotation.metadata.toolName === UltrasoundPleuraBLineTool.toolName) {
        updateAnnotatedFrames();
      }
    },
    [viewportGridService, cornerstoneViewportService, imageIdsToObserve]
  );

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

  return (
    <div
      className="text-foreground h-full bg-background"
      style={{ minWidth: 240, maxWidth: 480, width: '100%' }}
    >
      <PanelSection>
        <PanelSection.Header>{t('Rater')}</PanelSection.Header>
        {renderRater()}
      </PanelSection>

      <PanelSection>
        <PanelSection.Header>{t('Sector Annotations')}</PanelSection.Header>
        {renderSectorAnnotations()}
      </PanelSection>

      <PanelSection className="flex-1">
        <PanelSection.Header>{t('Annotated Frames')}</PanelSection.Header>
        {renderAnnotatedFrames()}
      </PanelSection>

      <PanelSection defaultOpen={false}>
        <PanelSection.Header>{t('Clip level labels')}</PanelSection.Header>
        <PanelSection.Content>
          <ClipLevelLabels selectedLabels={clipLabels} onChange={setClipLabels} />
        </PanelSection.Content>
      </PanelSection>

      <PanelSection>
        <PanelSection.Header>{t('Settings')}</PanelSection.Header>
        {renderSettingsToggles()}
      </PanelSection>
    </div>
  );
}
