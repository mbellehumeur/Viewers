import React from 'react';
import { Enums } from '@cornerstonejs/core';
import { cn, useIconPresentation } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { Popover, PopoverTrigger, PopoverContent, Button, Icons } from '@ohif/ui-next';
import {
  getVolume3DRenderModeOverride,
  isNextViewportsEnabled,
} from '../../utils/nextViewports';

const LEGACY_MODE = 'legacy';

/** Selectable modes shown in the corner menu popover. */
const RENDER_MODES: { value: string; label: string }[] = [
  { value: LEGACY_MODE, label: 'vtk (WebGL)' },
  { value: 'vtkVolume3d', label: 'next-vtk (WebGL)' },
  { value: 'mviewVolume3d', label: 'next-mview (WebGPU)' },
];

/** Labels for known modes, including URL-only overrides not in the menu. */
const MODE_LABELS: Record<string, string> = {
  [LEGACY_MODE]: 'vtk (WebGL)',
  vtkVolume3d: 'next-vtk (WebGL)',
  mviewVolume3d: 'next-mview (WebGPU)',
  slicerLiveVolume3d: 'slicerLive (WebGPU)',
};

const NEXT_PATH_MODES = new Set([
  ...RENDER_MODES.map(m => m.value).filter(v => v !== LEGACY_MODE),
  'slicerLiveVolume3d',
]);

function labelForMode(mode: string | undefined): string {
  if (!mode) {
    return 'Render';
  }
  return MODE_LABELS[mode] ?? 'Render';
}

function readRenderMode(
  viewport: { getActiveRenderMode?: () => string } | null | undefined
): string | undefined {
  if (!isNextViewportsEnabled()) {
    return LEGACY_MODE;
  }
  // Override is set synchronously on switch; prefer it so the trigger updates
  // before setDisplaySets finishes remounting.
  const mode = getVolume3DRenderModeOverride() ?? viewport?.getActiveRenderMode?.();
  if (mode && NEXT_PATH_MODES.has(mode)) {
    return mode;
  }
  // Unknown next paths (e.g. leftover fuberlin/webgpu URL) still show a label.
  return mode;
}

function ViewportRenderModeMenu({
  location,
  viewportId,
  isOpen = false,
  onOpen,
  onClose,
  disabled,
  ...props
}: withAppTypes<{
  location?: string;
  viewportId: string;
  isOpen?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  disabled?: boolean;
}>) {
  const { servicesManager, commandsManager } = useSystem();
  const { cornerstoneViewportService, toolbarService } = servicesManager.services;
  const { IconContainer, className: iconClassName, containerProps } = useIconPresentation();

  const getViewport = React.useCallback(() => {
    return cornerstoneViewportService.getCornerstoneViewport(viewportId) as
      | { getActiveRenderMode?: () => string; element?: HTMLElement }
      | null
      | undefined;
  }, [cornerstoneViewportService, viewportId]);

  const [currentMode, setCurrentMode] = React.useState<string | undefined>(() =>
    readRenderMode(getViewport())
  );

  const syncFromViewport = React.useCallback(() => {
    const nextMode = readRenderMode(getViewport());
    setCurrentMode(prev => (prev === nextMode ? prev : nextMode));
  }, [getViewport]);

  // Keep the trigger in sync after remount / render (same pattern as overlay badge).
  React.useEffect(() => {
    syncFromViewport();

    const element = getViewport()?.element;
    if (!element) {
      return;
    }

    element.addEventListener(Enums.Events.IMAGE_RENDERED, syncFromViewport);
    return () => {
      element.removeEventListener(Enums.Events.IMAGE_RENDERED, syncFromViewport);
    };
  }, [getViewport, syncFromViewport, viewportId]);

  // Refresh when the popover opens (do not re-read on close — that races remount).
  React.useEffect(() => {
    if (isOpen) {
      syncFromViewport();
    }
  }, [isOpen, syncFromViewport]);

  const handleModeChange = async (mode: string) => {
    if (mode === currentMode) {
      onClose?.();
      return;
    }

    const onNext = isNextViewportsEnabled();

    // Legacy ↔ next: soft remount (flip session lane + remount viewports).
    if (mode === LEGACY_MODE) {
      setCurrentMode(LEGACY_MODE);
      onClose?.();
      await commandsManager.runCommand('setViewportBackendLane', {
        useNextViewports: false,
      });
      syncFromViewport();
      return;
    }

    if (!onNext) {
      setCurrentMode(mode);
      onClose?.();
      await commandsManager.runCommand('setViewportBackendLane', {
        useNextViewports: true,
        renderMode: mode,
      });
      syncFromViewport();
      return;
    }

    // Already on next: hot-switch Volume3D render path only.
    setCurrentMode(mode);
    onClose?.();
    await commandsManager.runCommand('setVolume3DRenderMode', {
      viewportId,
      mode,
    });
    syncFromViewport();
  };

  const handleOpenChange = (openState: boolean) => {
    if (openState) {
      onOpen?.();
    } else {
      onClose?.();
    }
  };

  const { align, side } = toolbarService.getAlignAndSide(Number(location));
  const triggerLabel = labelForMode(currentMode);

  // Avoid spreading a static toolbar `label` that would override the live mode name.
  const { label: _ignoredLabel, icon: _ignoredIcon, ...restProps } = props as {
    label?: string;
    icon?: string;
    [key: string]: unknown;
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={handleOpenChange}
    >
      <PopoverTrigger
        asChild
        className={cn('flex items-center justify-center')}
      >
        <div>
          {IconContainer ? (
            <IconContainer
              disabled={disabled}
              label={triggerLabel}
              tooltip={restProps.tooltip as string | undefined}
              {...restProps}
              {...containerProps}
              // Tiny action-corner buttons default to w-6; this label is wider and
              // must size to content or the right edge is clipped by the pane.
              className={cn(
                (containerProps as { className?: string }).className,
                'h-6 w-auto min-w-6 px-1'
              )}
            >
              <span className={cn(iconClassName, 'px-0.5 text-xs font-medium leading-none')}>
                {triggerLabel}
              </span>
            </IconContainer>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              disabled={disabled}
              onClick={() => {}}
              className="h-7 w-auto min-w-7 px-1 text-xs font-medium"
            >
              {triggerLabel}
            </Button>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-[190px] flex-shrink-0 flex-col items-start rounded p-1"
        align={align}
        side={side}
        collisionPadding={8}
      >
        {RENDER_MODES.map(({ value, label }) => (
          <Button
            key={value}
            variant="ghost"
            className="flex h-8 w-full flex-shrink-0 items-center justify-start self-stretch px-1 py-0 text-sm"
            onClick={() => {
              void handleModeChange(value);
            }}
          >
            <div className="mr-1 flex w-6 items-center justify-start">
              {currentMode === value ? <Icons.Checked className="text-primary h-5 w-5" /> : null}
            </div>
            <div className="flex-1 text-left">{label}</div>
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export default ViewportRenderModeMenu;
