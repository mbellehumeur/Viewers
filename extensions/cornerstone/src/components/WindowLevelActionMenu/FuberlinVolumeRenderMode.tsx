import React, { ReactElement, useCallback, useEffect, useState } from 'react';
import {
  getFuberlinVolume3D,
  getFuberlinVolume3DRenderMode,
  type FuberlinVolume3DRenderMode as FuberlinMode,
} from '@cornerstonejs/core';
import { ToggleGroup, ToggleGroupItem } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { useTranslation } from 'react-i18next';

const MODES: { value: FuberlinMode; labelKey: string }[] = [
  { value: 'surface', labelKey: 'Surface' },
  { value: 'composite', labelKey: 'Composite' },
  { value: 'mip', labelKey: 'MIP' },
];

export function FuberlinVolumeRenderMode({
  viewportId,
  onModeChange: onModeChangeProp,
}: {
  viewportId?: string;
  onModeChange?: (mode: FuberlinMode) => void;
} = {}): ReactElement | null {
  const { t } = useTranslation('WindowLevelActionMenu');
  const { commandsManager } = useSystem();
  const isFuberlin = Boolean(viewportId && getFuberlinVolume3D(viewportId));
  const [mode, setMode] = useState<FuberlinMode>(() =>
    viewportId && isFuberlin
      ? (getFuberlinVolume3DRenderMode(viewportId) ?? 'surface')
      : 'surface'
  );

  useEffect(() => {
    if (!viewportId || !isFuberlin) {
      return;
    }
    setMode(getFuberlinVolume3DRenderMode(viewportId) ?? 'surface');
  }, [viewportId, isFuberlin]);

  const onModeChange = useCallback(
    (next: string) => {
      if (!viewportId || !next) {
        return;
      }
      const nextMode = next as FuberlinMode;
      setMode(nextMode);
      commandsManager.runCommand('setFuberlinVolumeRenderMode', {
        viewportId,
        mode: next,
      });
      onModeChangeProp?.(nextMode);
    },
    [commandsManager, viewportId, onModeChangeProp]
  );

  if (!isFuberlin || !viewportId) {
    return null;
  }

  return (
    <div className="mb-2 flex w-full flex-col gap-1 px-2">
      <div className="text-muted-foreground text-sm">{t('Render Mode')}</div>
      <ToggleGroup
        type="single"
        value={mode}
        onValueChange={onModeChange}
        className="grid w-full grid-cols-3 gap-1"
      >
        {MODES.map(({ value, labelKey }) => (
          <ToggleGroupItem
            key={value}
            value={value}
            size="sm"
            className="px-1 text-xs"
          >
            {t(labelKey)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
