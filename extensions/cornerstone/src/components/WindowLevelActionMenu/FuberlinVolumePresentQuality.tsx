import React, { ReactElement, useCallback, useEffect, useState } from 'react';
import {
  getFuberlinVolume3D,
  getFuberlinVolume3DPresentQuality,
  getFuberlinVolume3DRenderMode,
  type FuberlinVolume3DRenderMode as FuberlinMode,
} from '@cornerstonejs/core';
import { Numeric } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { useTranslation } from 'react-i18next';

const DEFAULT_QUALITY = 1; // OHIF

export function FuberlinVolumePresentQuality({
  viewportId,
  renderMode,
}: {
  viewportId?: string;
  renderMode?: FuberlinMode;
} = {}): ReactElement | null {
  const { t } = useTranslation('WindowLevelActionMenu');
  const { commandsManager } = useSystem();
  const isFuberlin = Boolean(viewportId && getFuberlinVolume3D(viewportId));
  const mode =
    renderMode ??
    (viewportId && isFuberlin
      ? (getFuberlinVolume3DRenderMode(viewportId) ?? 'composite')
      : undefined);
  const [quality, setQuality] = useState<number>(() =>
    viewportId && isFuberlin
      ? (getFuberlinVolume3DPresentQuality(viewportId) ?? DEFAULT_QUALITY)
      : DEFAULT_QUALITY
  );

  useEffect(() => {
    if (!viewportId || !isFuberlin) {
      return;
    }
    setQuality(
      getFuberlinVolume3DPresentQuality(viewportId) ?? DEFAULT_QUALITY
    );
  }, [viewportId, isFuberlin, mode]);

  const onChange = useCallback(
    (value: number) => {
      if (!viewportId) {
        return;
      }
      setQuality(value);
      commandsManager.runCommand('setFuberlinVolumePresentQuality', {
        viewportId,
        quality: value,
      });
    },
    [commandsManager, viewportId]
  );

  if (!isFuberlin || !viewportId || mode !== 'composite') {
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
          <div className="text-muted-foreground mt-1 flex justify-between px-16 text-xs">
            <span>{t('MView')}</span>
            <span>{t('OHIF')}</span>
          </div>
        </Numeric.Container>
      </div>
    </div>
  );
}
