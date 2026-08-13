import React, { ReactElement, useCallback, useEffect, useState } from 'react';
import {
  getMviewVolume3D,
  getMviewVolume3DRenderMode,
  getMviewVolume3DThreshold,
  type MviewVolume3DRenderMode as MviewMode,
} from '@cornerstonejs/core';
import { Numeric } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { useTranslation } from 'react-i18next';

export function MviewVolumeThreshold({
  viewportId,
  renderMode,
}: {
  viewportId?: string;
  renderMode?: MviewMode;
} = {}): ReactElement | null {
  const { t } = useTranslation('WindowLevelActionMenu');
  const { commandsManager } = useSystem();
  const isMview = Boolean(viewportId && getMviewVolume3D(viewportId));
  const mode =
    renderMode ??
    (viewportId && isMview
      ? (getMviewVolume3DRenderMode(viewportId) ?? 'composite')
      : undefined);
  const [threshold, setThreshold] = useState<number | null>(() => {
    if (!viewportId || !isMview) {
      return null;
    }
    const value = getMviewVolume3DThreshold(viewportId);
    return typeof value === 'number' ? value : 0.35;
  });

  useEffect(() => {
    if (!viewportId || !isMview) {
      setThreshold(null);
      return;
    }
    const value = getMviewVolume3DThreshold(viewportId);
    setThreshold(typeof value === 'number' ? value : 0.35);
  }, [viewportId, isMview, mode]);

  const onChange = useCallback(
    (value: number) => {
      if (!viewportId) {
        return;
      }
      setThreshold(value);
      commandsManager.runCommand('setMviewVolumeThreshold', {
        viewportId,
        threshold: value,
      });
    },
    [commandsManager, viewportId]
  );

  // Threshold is unused in composite raymarch (TF opacity only).
  if (
    !isMview ||
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
