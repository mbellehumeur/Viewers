import React, { ReactElement, useCallback, useEffect, useState } from 'react';
import {
  getSlicerLiveVolume3D,
  getSlicerLiveVolume3DLighting,
} from '@cornerstonejs/core';
import { Numeric } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { useTranslation } from 'react-i18next';

type LightingValues = {
  ambient: number;
  diffuse: number;
  specular: number;
};

const DEFAULT_LIGHTING: LightingValues = {
  ambient: 0.25,
  diffuse: 0.75,
  specular: 0.5,
};

export function SlicerLiveVolumeLighting({
  viewportId,
  hasShade,
}: {
  viewportId?: string;
  hasShade: boolean;
}): ReactElement | null {
  const { commandsManager } = useSystem();
  const { t } = useTranslation('WindowLevelActionMenu');
  const isSlicerLive = Boolean(viewportId && getSlicerLiveVolume3D(viewportId));
  const [lightingValues, setLightingValues] = useState<LightingValues>(() =>
    viewportId && isSlicerLive
      ? (getSlicerLiveVolume3DLighting(viewportId) ?? DEFAULT_LIGHTING)
      : DEFAULT_LIGHTING
  );

  useEffect(() => {
    if (!viewportId || !isSlicerLive) {
      return;
    }
    setLightingValues(getSlicerLiveVolume3DLighting(viewportId) ?? DEFAULT_LIGHTING);
  }, [viewportId, isSlicerLive]);

  const onLightingChange = useCallback(
    (property: keyof LightingValues, value: number) => {
      if (!viewportId) {
        return;
      }
      setLightingValues(prev => ({
        ...prev,
        [property]: value,
      }));
      commandsManager.runCommand('setSlicerLiveVolumeLighting', {
        viewportId,
        options: { [property]: value },
      });
    },
    [commandsManager, viewportId]
  );

  if (!isSlicerLive || !viewportId) {
    return null;
  }

  const disableOption = hasShade ? '' : 'ohif-disabled !opacity-40';
  const lightingProperties: { key: keyof LightingValues; label: string }[] = [
    { key: 'ambient', label: t('Ambient') },
    { key: 'diffuse', label: t('Diffuse') },
    { key: 'specular', label: t('Specular') },
  ];

  return (
    <div className="my-1 mt-2 flex flex-col space-y-2">
      {lightingProperties.map(({ key, label }) => (
        <div
          key={key}
          className={`w-full pl-2 pr-1 ${disableOption}`}
        >
          <Numeric.Container
            mode="singleRange"
            min={0}
            max={1}
            step={0.1}
            value={lightingValues[key]}
            onChange={value => onLightingChange(key, value as number)}
          >
            <div className="flex flex-row items-center">
              <Numeric.Label className="w-16">{label}</Numeric.Label>
              <Numeric.SingleRange sliderClassName="mx-2 flex-grow" />
            </div>
          </Numeric.Container>
        </div>
      ))}
    </div>
  );
}
