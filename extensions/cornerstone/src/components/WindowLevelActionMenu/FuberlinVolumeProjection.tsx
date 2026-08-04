import React, { ReactElement, useCallback, useEffect, useState } from 'react';
import {
  getFuberlinVolume3D,
  getFuberlinVolume3DProjection,
  type FuberlinVolume3DProjection,
} from '@cornerstonejs/core';
import { ToggleGroup, ToggleGroupItem } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { useTranslation } from 'react-i18next';

const PROJECTIONS: { value: FuberlinVolume3DProjection; labelKey: string }[] = [
  { value: 'orthographic', labelKey: 'Orthographic' },
  { value: 'perspective', labelKey: 'Perspective' },
];

export function FuberlinVolumeProjection({
  viewportId,
}: {
  viewportId?: string;
} = {}): ReactElement | null {
  const { t } = useTranslation('WindowLevelActionMenu');
  const { commandsManager } = useSystem();
  const isFuberlin = Boolean(viewportId && getFuberlinVolume3D(viewportId));
  const [projection, setProjection] = useState<FuberlinVolume3DProjection>(() =>
    viewportId && isFuberlin
      ? (getFuberlinVolume3DProjection(viewportId) ?? 'orthographic')
      : 'orthographic'
  );

  useEffect(() => {
    if (!viewportId || !isFuberlin) {
      return;
    }
    setProjection(getFuberlinVolume3DProjection(viewportId) ?? 'orthographic');
  }, [viewportId, isFuberlin]);

  const onProjectionChange = useCallback(
    (next: string) => {
      if (!viewportId || !next) {
        return;
      }
      setProjection(next as FuberlinVolume3DProjection);
      commandsManager.runCommand('setFuberlinVolumeProjection', {
        viewportId,
        projection: next,
      });
    },
    [commandsManager, viewportId]
  );

  if (!isFuberlin || !viewportId) {
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
