import React, { ReactElement, useCallback, useEffect, useState } from 'react';
import { Switch } from '@ohif/ui-next';
import { VolumeShadeProps } from '../../types/ViewportPresets';
import { useSystem } from '@ohif/core';
import { useTranslation } from 'react-i18next';

export function VolumeShade({
  viewportId,
  onClickShade = bool => {},
}: VolumeShadeProps): ReactElement | null {
  const { t } = useTranslation('WindowLevelActionMenu');
  const { servicesManager, commandsManager } = useSystem();
  const { cornerstoneViewportService } = servicesManager.services;
  const [shade, setShade] = useState(true);
  const [key, setKey] = useState(0);

  const onShadeChange = useCallback(
    (checked: boolean) => {
      commandsManager.runCommand('setVolumeLighting', { viewportId, options: { shade: checked } });
    },
    [commandsManager, viewportId]
  );
  useEffect(() => {
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    const actor = viewport?.getActors?.()?.[0]?.actor;
    if (!actor?.getProperty) {
      return;
    }
    const nextShade = actor.getProperty().getShade();
    setShade(nextShade);
    onClickShade(nextShade);
    setKey(prev => prev + 1);
  }, [viewportId, cornerstoneViewportService]); // eslint-disable-line react-hooks/exhaustive-deps -- onClickShade is optional parent setter

  const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
  const actor = viewport?.getActors?.()?.[0]?.actor;
  if (!actor) {
    return null;
  }

  return (
    <>
      <span className="flex-grow">{t('Shade')}</span>
      <Switch
        className="ml-2 flex-shrink-0"
        key={key}
        checked={shade}
        onCheckedChange={() => {
          setShade(!shade);
          onClickShade(!shade);
          onShadeChange(!shade);
        }}
      />
    </>
  );
}
