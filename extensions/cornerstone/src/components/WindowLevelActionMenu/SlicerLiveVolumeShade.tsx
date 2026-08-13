import React, { ReactElement, useCallback, useEffect, useState } from 'react';
import {
  getSlicerLiveVolume3D,
  getSlicerLiveVolume3DShade,
} from '@cornerstonejs/core';
import { Switch } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { useTranslation } from 'react-i18next';

export function SlicerLiveVolumeShade({
  viewportId,
  onShadeChange: onShadeChangeProp,
}: {
  viewportId?: string;
  onShadeChange?: (shade: boolean) => void;
} = {}): ReactElement | null {
  const { t } = useTranslation('WindowLevelActionMenu');
  const { commandsManager } = useSystem();
  const isSlicerLive = Boolean(viewportId && getSlicerLiveVolume3D(viewportId));
  const [shade, setShade] = useState(() =>
    viewportId && isSlicerLive ? (getSlicerLiveVolume3DShade(viewportId) ?? true) : true
  );

  useEffect(() => {
    if (!viewportId || !isSlicerLive) {
      return;
    }
    const next = getSlicerLiveVolume3DShade(viewportId) ?? true;
    setShade(next);
    onShadeChangeProp?.(next);
  }, [viewportId, isSlicerLive]); // eslint-disable-line react-hooks/exhaustive-deps -- parent setter optional

  const onShadeChange = useCallback(
    (checked: boolean) => {
      if (!viewportId) {
        return;
      }
      setShade(checked);
      onShadeChangeProp?.(checked);
      commandsManager.runCommand('setSlicerLiveVolumeShade', {
        viewportId,
        shade: checked,
      });
    },
    [commandsManager, viewportId, onShadeChangeProp]
  );

  if (!isSlicerLive || !viewportId) {
    return null;
  }

  return (
    <div className="hover:bg-accent flex h-8 w-full flex-shrink-0 items-center px-2 text-base hover:rounded">
      <span className="flex-grow">{t('Shade')}</span>
      <Switch
        className="ml-2 flex-shrink-0"
        checked={shade}
        onCheckedChange={onShadeChange}
      />
    </div>
  );
}
