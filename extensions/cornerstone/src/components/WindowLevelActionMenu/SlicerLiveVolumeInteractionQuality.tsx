import React, { ReactElement, useCallback, useEffect, useState } from 'react';
import {
  getSlicerLiveVolume3D,
  getSlicerLiveVolume3DInteractionQuality,
} from '@cornerstonejs/core';
import { Numeric } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { useTranslation } from 'react-i18next';

const DEFAULT_QUALITY = 0.35;

export function SlicerLiveVolumeInteractionQuality({
  viewportId,
}: {
  viewportId?: string;
} = {}): ReactElement | null {
  const { t } = useTranslation('WindowLevelActionMenu');
  const { commandsManager } = useSystem();
  const isSlicerLive = Boolean(viewportId && getSlicerLiveVolume3D(viewportId));
  const [quality, setQuality] = useState(() =>
    viewportId && isSlicerLive
      ? (getSlicerLiveVolume3DInteractionQuality(viewportId) ?? DEFAULT_QUALITY)
      : DEFAULT_QUALITY
  );

  useEffect(() => {
    if (!viewportId || !isSlicerLive) {
      return;
    }
    setQuality(getSlicerLiveVolume3DInteractionQuality(viewportId) ?? DEFAULT_QUALITY);
  }, [viewportId, isSlicerLive]);

  const onChange = useCallback(
    (value: number) => {
      if (!viewportId) {
        return;
      }
      setQuality(value);
      commandsManager.runCommand('setSlicerLiveVolumeInteractionQuality', {
        viewportId,
        quality: value,
      });
    },
    [commandsManager, viewportId]
  );

  if (!isSlicerLive || !viewportId) {
    return null;
  }

  return (
    <div className="my-1 mt-2 flex flex-col space-y-2">
      <div className="w-full pl-2 pr-1">
        <Numeric.Container
          mode="singleRange"
          min={0}
          max={1}
          step={0.01}
          value={quality}
          onChange={onChange}
        >
          <div className="flex flex-row items-center">
            <Numeric.Label className="w-16">{t('Resolution')}</Numeric.Label>
            <Numeric.SingleRange sliderClassName="mx-2 flex-grow" />
          </div>
          <div className="text-muted-foreground mt-1 px-2 text-xs">{quality.toFixed(2)}</div>
        </Numeric.Container>
      </div>
    </div>
  );
}
