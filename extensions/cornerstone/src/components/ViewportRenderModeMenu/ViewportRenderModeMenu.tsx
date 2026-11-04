import React from 'react';
import { Enums, getEffectiveRenderBackend } from '@cornerstonejs/core';
import { cn, useIconPresentation } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { Popover, PopoverTrigger, PopoverContent, Button, Icons } from '@ohif/ui-next';
import {
  getVolume3DRenderModeOverride,
  isNextViewportsEnabled,
  isVtkWasmRegistered,
  isVtkWasmWebgpuRegistered,
} from '../../utils/nextViewports';
import VtkWasmBrickingSubMenu from './VtkWasmBrickingSubMenu';

type VtkWasmBrickPresetId = 'minimal' | '2x2x2' | '4x4x4' | '8x8x8';

const LEGACY_MODE = 'legacy';

/** Base selectable modes shown in the Volume3D corner menu popover. */
const BASE_VOLUME3D_RENDER_MODES: { value: string; label: string }[] = [
  { value: LEGACY_MODE, label: 'vtk-js (WebGL)' },
  { value: 'vtkVolume3d', label: 'next-vtk-js (WebGL)' },
  { value: 'mviewVolume3d', label: 'next-mview (WebGPU)' },
  { value: 'slicerLiveVolume3d', label: 'next-slicerLive (WebGPU)' },
];

/** Base selectable backends shown in the MPR / planar corner menu popover. */
const BASE_PLANAR_RENDER_BACKENDS: { value: string; label: string }[] = [
  { value: LEGACY_MODE, label: 'vtk-js (WebGL)' },
  { value: 'gpu', label: 'next-vtk-js (WebGL)' },
];

/** Labels for known modes/backends, including URL-only overrides not in the menu. */
const MODE_LABELS: Record<string, string> = {
  [LEGACY_MODE]: 'vtk-js (WebGL)',
  vtkVolume3d: 'next-vtk-js (WebGL)',
  vtkWasmVolume3d: 'next-vtk-wasm (WebGL)',
  vtkWasmWebgpuVolume3d: 'next-vtk-wasm (WebGPU)',
  mviewVolume3d: 'next-mview (WebGPU)',
  slicerLiveVolume3d: 'next-slicerLive (WebGPU)',
  gpu: 'next-vtk-js (WebGL)',
  webgl: 'next-vtk-js (WebGL)',
  vtkWasm: 'next-vtk-wasm (WebGL)',
  cpu: 'next-cpu',
  auto: 'next-auto',
  webgpu: 'next-webgpu',
};

const NEXT_VOLUME3D_PATH_MODES = new Set([
  ...BASE_VOLUME3D_RENDER_MODES.map(m => m.value).filter(v => v !== LEGACY_MODE),
  'vtkWasmVolume3d',
  'vtkWasmWebgpuVolume3d',
]);

function isVolume3DViewport(
  viewport: { type?: string; getActiveRenderMode?: () => string } | null | undefined
): boolean {
  if (!viewport) {
    return false;
  }
  if (typeof viewport.getActiveRenderMode === 'function') {
    return true;
  }
  return (
    viewport.type === Enums.ViewportType.VOLUME_3D ||
    viewport.type === Enums.ViewportType.VOLUME_3D_NEXT
  );
}

function getVolume3DMenuRenderModes(): { value: string; label: string }[] {
  const modes = [...BASE_VOLUME3D_RENDER_MODES];
  // Omit when wasm failed to register so the menu has no dead entries.
  let insertAt = 2;
  if (isVtkWasmRegistered()) {
    modes.splice(insertAt, 0, {
      value: 'vtkWasmVolume3d',
      label: 'next-vtk-wasm (WebGL)',
    });
    insertAt += 1;
  }
  if (isVtkWasmWebgpuRegistered()) {
    modes.splice(insertAt, 0, {
      value: 'vtkWasmWebgpuVolume3d',
      label: 'next-vtk-wasm (WebGPU)',
    });
  }
  return modes;
}

function getPlanarMenuRenderBackends(): { value: string; label: string }[] {
  const modes = [...BASE_PLANAR_RENDER_BACKENDS];
  if (isVtkWasmRegistered()) {
    modes.push({
      value: 'vtkWasm',
      label: 'next-vtk-wasm (WebGL)',
    });
  }
  return modes;
}

function labelForMode(mode: string | undefined): string {
  if (!mode) {
    return 'Render';
  }
  return MODE_LABELS[mode] ?? 'Render';
}

function readVolume3DRenderMode(
  viewport: { getActiveRenderMode?: () => string } | null | undefined
): string | undefined {
  if (!isNextViewportsEnabled()) {
    return LEGACY_MODE;
  }
  // Override is set synchronously on switch; prefer it so the trigger updates
  // before setDisplaySets finishes remounting.
  const mode = getVolume3DRenderModeOverride() ?? viewport?.getActiveRenderMode?.();
  if (mode && NEXT_VOLUME3D_PATH_MODES.has(mode)) {
    return mode;
  }
  // Unknown next paths (e.g. leftover webgpu URL) still show a label.
  return mode;
}

function readPlanarRenderBackend(): string | undefined {
  if (!isNextViewportsEnabled()) {
    return LEGACY_MODE;
  }
  return getEffectiveRenderBackend();
}

function isVtkWasmWebglMode(mode: string | undefined, isVolume3D: boolean): boolean {
  if (!mode) {
    return false;
  }
  return isVolume3D ? mode === 'vtkWasmVolume3d' : mode === 'vtkWasm';
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
      | { type?: string; getActiveRenderMode?: () => string; element?: HTMLElement }
      | null
      | undefined;
  }, [cornerstoneViewportService, viewportId]);

  const isVolume3D = isVolume3DViewport(getViewport());

  const readCurrentMode = React.useCallback(() => {
    const viewport = getViewport();
    return isVolume3DViewport(viewport)
      ? readVolume3DRenderMode(viewport)
      : readPlanarRenderBackend();
  }, [getViewport]);

  const [currentMode, setCurrentMode] = React.useState<string | undefined>(() => readCurrentMode());
  const [panel, setPanel] = React.useState<'renderMode' | 'bricking'>('renderMode');

  const syncFromViewport = React.useCallback(() => {
    const nextMode = readCurrentMode();
    setCurrentMode(prev => (prev === nextMode ? prev : nextMode));
  }, [readCurrentMode]);

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
    const volume3D = isVolume3DViewport(getViewport());

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
      if (volume3D) {
        await commandsManager.runCommand('setViewportBackendLane', {
          useNextViewports: true,
          renderMode: mode,
        });
      } else {
        await commandsManager.runCommand('setViewportBackendLane', {
          useNextViewports: true,
        });
        await commandsManager.runCommand('setPlanarRenderBackend', {
          backend: mode,
        });
      }
      syncFromViewport();
      return;
    }

    setCurrentMode(mode);
    onClose?.();
    if (volume3D) {
      await commandsManager.runCommand('setVolume3DRenderMode', {
        viewportId,
        mode,
      });
    } else {
      await commandsManager.runCommand('setPlanarRenderBackend', {
        backend: mode,
      });
    }
    syncFromViewport();
  };

  const handleOpenChange = (openState: boolean) => {
    if (openState) {
      setPanel('renderMode');
      onOpen?.();
    } else {
      onClose?.();
    }
  };

  const handleBrickingSelect = async (preset: VtkWasmBrickPresetId) => {
    onClose?.();
    setPanel('renderMode');
    await commandsManager.runCommand('setVtkWasmBrickPreset', {
      viewportId,
      preset,
    });
    syncFromViewport();
  };

  const { align, side } = toolbarService.getAlignAndSide(Number(location));
  const triggerLabel = labelForMode(currentMode);
  const menuItems = isVolume3D ? getVolume3DMenuRenderModes() : getPlanarMenuRenderBackends();
  const showBrickingSubMenu = isVtkWasmWebglMode(currentMode, isVolume3D);
  const brickingPath = isVolume3D ? 'volume3d' : 'mpr';

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
        {panel === 'bricking' ? (
          <VtkWasmBrickingSubMenu
            path={brickingPath}
            onBack={() => {
              setPanel('renderMode');
            }}
            onSelect={preset => {
              void handleBrickingSelect(preset);
            }}
          />
        ) : (
          <>
            {menuItems.map(({ value, label }) => (
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
            {showBrickingSubMenu ? (
              <>
                <div className="bg-border my-1 h-px w-full" />
                <Button
                  variant="ghost"
                  className="flex h-8 w-full flex-shrink-0 items-center justify-start self-stretch px-1 py-0 text-sm"
                  onClick={() => {
                    setPanel('bricking');
                  }}
                >
                  <div className="mr-1 flex w-6 items-center justify-start" />
                  <div className="flex-1 text-left">Bricking</div>
                  <Icons.ChevronRight className="text-muted-foreground h-4 w-4" />
                </Button>
              </>
            ) : null}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default ViewportRenderModeMenu;
