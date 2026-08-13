import React, { ReactElement, useCallback, useEffect, useState } from 'react';
import {
  getMviewVolume3D,
  getMviewVolume3DRenderMode,
  type MviewVolume3DRenderMode as MviewMode,
} from '@cornerstonejs/core';
import { ToggleGroup, ToggleGroupItem } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { useTranslation } from 'react-i18next';

const MODES: { value: MviewMode; labelKey: string }[] = [
  { value: 'surface', labelKey: 'Surface' },
  { value: 'composite', labelKey: 'Composite' },
  { value: 'mip', labelKey: 'MIP' },
];

export function MviewVolumeRenderMode({
  viewportId,
  onModeChange: onModeChangeProp,
}: {
  viewportId?: string;
  onModeChange?: (mode: MviewMode) => void;
} = {}): ReactElement | null {
  const { t } = useTranslation('WindowLevelActionMenu');
  const { commandsManager } = useSystem();
  const isMview = Boolean(viewportId && getMviewVolume3D(viewportId));
  const [mode, setMode] = useState<MviewMode>(() =>
    viewportId && isMview
      ? (getMviewVolume3DRenderMode(viewportId) ?? 'surface')
      : 'surface'
  );

  useEffect(() => {
    if (!viewportId || !isMview) {
      return;
    }
    setMode(getMviewVolume3DRenderMode(viewportId) ?? 'surface');
  }, [viewportId, isMview]);

  const onModeChange = useCallback(
    (next: string) => {
      if (!viewportId || !next) {
        return;
      }
      const nextMode = next as MviewMode;
      setMode(nextMode);
      commandsManager.runCommand('setMviewVolumeRenderMode', {
        viewportId,
        mode: next,
      });
      onModeChangeProp?.(nextMode);
    },
    [commandsManager, viewportId, onModeChangeProp]
  );

  if (!isMview || !viewportId) {
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
