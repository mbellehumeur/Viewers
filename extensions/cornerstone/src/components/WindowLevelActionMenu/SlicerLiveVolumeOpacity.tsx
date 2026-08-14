import React, { ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import {
  getSlicerLiveVolume3D,
  getSlicerLiveVolume3DVolumeOpacity,
} from '@cornerstonejs/core';
import { Numeric, Switch } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { useTranslation } from 'react-i18next';

/**
 * SlicerLive volume opacity (0–100%) + Hide volume switch.
 * Scales the volume opacity TF so SEG remains fully visible.
 */
export function SlicerLiveVolumeOpacity({
  viewportId,
}: {
  viewportId?: string;
} = {}): ReactElement | null {
  const { t } = useTranslation('WindowLevelActionMenu');
  const { commandsManager } = useSystem();
  const isSlicerLive = Boolean(viewportId && getSlicerLiveVolume3D(viewportId));
  const [opacity, setOpacity] = useState(() =>
    viewportId && isSlicerLive
      ? (getSlicerLiveVolume3DVolumeOpacity(viewportId) ?? 1)
      : 1
  );
  const opacityBeforeHideRef = useRef(1);

  useEffect(() => {
    if (!viewportId || !isSlicerLive) {
      return;
    }
    setOpacity(getSlicerLiveVolume3DVolumeOpacity(viewportId) ?? 1);
  }, [viewportId, isSlicerLive]);

  const applyOpacity = useCallback(
    (next: number) => {
      if (!viewportId) {
        return;
      }
      const clamped = Math.max(0, Math.min(1, next));
      setOpacity(clamped);
      commandsManager.runCommand('setSlicerLiveVolumeOpacity', {
        viewportId,
        opacity: clamped,
      });
    },
    [commandsManager, viewportId]
  );

  const onHideChange = useCallback(
    (checked: boolean) => {
      if (checked) {
        if (opacity > 0) {
          opacityBeforeHideRef.current = opacity;
        }
        applyOpacity(0);
      } else {
        applyOpacity(opacityBeforeHideRef.current > 0 ? opacityBeforeHideRef.current : 1);
      }
    },
    [applyOpacity, opacity]
  );

  if (!viewportId || !isSlicerLive) {
    return null;
  }

  const hidden = opacity <= 0;

  return (
    <div className="my-1 mt-2 flex flex-col space-y-2">
      <div className="hover:bg-accent flex h-8 w-full flex-shrink-0 items-center px-2 text-base hover:rounded">
        <span className="flex-grow">{t('Hide volume')}</span>
        <Switch
          className="ml-2 flex-shrink-0"
          checked={hidden}
          onCheckedChange={onHideChange}
        />
      </div>
      <div className={`w-full pl-2 pr-1 ${hidden ? 'ohif-disabled !opacity-40' : ''}`}>
        <Numeric.Container
          mode="singleRange"
          min={0}
          max={1}
          step={0.01}
          value={opacity}
          onChange={value => applyOpacity(Number(value))}
        >
          <div className="flex flex-row items-center">
            <Numeric.Label className="w-16">{t('Opacity')}</Numeric.Label>
            <Numeric.SingleRange sliderClassName="mx-2 flex-grow" />
          </div>
        </Numeric.Container>
      </div>
    </div>
  );
}
