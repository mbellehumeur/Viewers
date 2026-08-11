import React, { ReactElement, useCallback, useEffect, useState } from 'react';
import {
  getFuberlinVolume3D,
  getFuberlinVolume3DRenderMode,
  getFuberlinVolume3DThreshold,
  type FuberlinVolume3DRenderMode as FuberlinMode,
} from '@cornerstonejs/core';
import { Numeric } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { useTranslation } from 'react-i18next';

export function FuberlinVolumeThreshold({
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
  const [threshold, setThreshold] = useState<number | null>(() => {
    if (!viewportId || !isFuberlin) {
      return null;
    }
    const value = getFuberlinVolume3DThreshold(viewportId);
    return typeof value === 'number' ? value : 0.35;
  });

  useEffect(() => {
    if (!viewportId || !isFuberlin) {
      setThreshold(null);
      return;
    }
    const value = getFuberlinVolume3DThreshold(viewportId);
    setThreshold(typeof value === 'number' ? value : 0.35);
  }, [viewportId, isFuberlin, mode]);

  const onChange = useCallback(
    (value: number) => {
      if (!viewportId) {
        return;
      }
      setThreshold(value);
      commandsManager.runCommand('setFuberlinVolumeThreshold', {
        viewportId,
        threshold: value,
      });
    },
    [commandsManager, viewportId]
  );

  // Threshold is unused in composite raymarch (TF opacity only).
  if (
    !isFuberlin ||
    !viewportId ||
    threshold === null ||
    mode === 'composite'
  ) {
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
          value={threshold}
          onChange={onChange}
        >
          <div className="flex flex-row items-center">
            <Numeric.Label className="w-16">{t('Threshold')}</Numeric.Label>
            <Numeric.SingleRange sliderClassName="mx-2 flex-grow" />
            <div className="w-10 text-right tabular-nums">
              {Math.round(threshold * 100)}%
            </div>
          </div>
        </Numeric.Container>
      </div>
    </div>
  );
}
