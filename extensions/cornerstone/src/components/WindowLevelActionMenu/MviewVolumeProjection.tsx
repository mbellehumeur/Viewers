import React, { ReactElement, useCallback, useEffect, useState } from 'react';
import {
  getMviewVolume3D,
  getMviewVolume3DProjection,
  type MviewVolume3DProjection,
} from '@cornerstonejs/core';
import { ToggleGroup, ToggleGroupItem } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { useTranslation } from 'react-i18next';

const PROJECTIONS: { value: MviewVolume3DProjection; labelKey: string }[] = [
  { value: 'orthographic', labelKey: 'Orthographic' },
  { value: 'perspective', labelKey: 'Perspective' },
];

export function MviewVolumeProjection({
  viewportId,
}: {
  viewportId?: string;
} = {}): ReactElement | null {
  const { t } = useTranslation('WindowLevelActionMenu');
  const { commandsManager } = useSystem();
  const isMview = Boolean(viewportId && getMviewVolume3D(viewportId));
  const [projection, setProjection] = useState<MviewVolume3DProjection>(() =>
    viewportId && isMview
      ? (getMviewVolume3DProjection(viewportId) ?? 'orthographic')
      : 'orthographic'
  );

  useEffect(() => {
    if (!viewportId || !isMview) {
      return;
    }
    setProjection(getMviewVolume3DProjection(viewportId) ?? 'orthographic');
  }, [viewportId, isMview]);

  const onProjectionChange = useCallback(
    (next: string) => {
      if (!viewportId || !next) {
        return;
      }
      setProjection(next as MviewVolume3DProjection);
      commandsManager.runCommand('setMviewVolumeProjection', {
        viewportId,
        projection: next,
      });
    },
    [commandsManager, viewportId]
  );

  if (!isMview || !viewportId) {
    return null;
  }

  return (
    <div className="mb-2 flex w-full flex-col gap-1 px-2">
      <div className="text-muted-foreground text-sm">{t('Projection')}</div>
      <ToggleGroup
        type="single"
        value={projection}
        onValueChange={onProjectionChange}
        className="grid w-full grid-cols-2 gap-1"
      >
        {PROJECTIONS.map(({ value, labelKey }) => (
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
