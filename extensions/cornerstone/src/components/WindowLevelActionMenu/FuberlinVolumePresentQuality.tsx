import React, { ReactElement, useCallback, useEffect, useState } from 'react';
import {
  FUBERLIN_DEFAULT_PRESENT_QUALITY,
  getFuberlinVolume3D,
  getFuberlinVolume3DPresentQuality,
  getFuberlinVolume3DPresentQualityProfiles,
  getFuberlinVolume3DRenderMode,
  type FuberlinVolume3DPresentQualityProfiles,
  type FuberlinVolume3DQualityProfileSnapshot,
  type FuberlinVolume3DRenderMode as FuberlinMode,
} from '@cornerstonejs/core';
import { Numeric } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { useTranslation } from 'react-i18next';

function formatPixelBudget(pixels: number): string {
  if (pixels >= 1_000_000) {
    return `${(pixels / 1_000_000).toFixed(1)}M`;
  }
  if (pixels >= 1_000) {
    return `${Math.round(pixels / 1_000)}k`;
  }
  return `${Math.round(pixels)}`;
}

function formatProfileLine(
  label: string,
  profile: FuberlinVolume3DQualityProfileSnapshot
): string {
  const min = profile.minimumScale.toFixed(2);
  const max = profile.maximumScale.toFixed(2);
  const scale =
    Math.abs(profile.minimumScale - profile.maximumScale) < 0.005
      ? min
      : `${min}–${max}`;
  return `${label}: ${formatPixelBudget(profile.pixelBudget)} px · scale ${scale} · ${profile.steps} steps`;
}

function readProfiles(
  viewportId: string
): FuberlinVolume3DPresentQualityProfiles | undefined {
  return getFuberlinVolume3DPresentQualityProfiles(viewportId);
}

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
      ? (getFuberlinVolume3DPresentQuality(viewportId) ??
        FUBERLIN_DEFAULT_PRESENT_QUALITY)
      : FUBERLIN_DEFAULT_PRESENT_QUALITY
  );
  const [profiles, setProfiles] = useState<
    FuberlinVolume3DPresentQualityProfiles | undefined
  >(() => (viewportId && isFuberlin ? readProfiles(viewportId) : undefined));

  useEffect(() => {
    if (!viewportId || !isFuberlin) {
      return;
    }
    setQuality(
      getFuberlinVolume3DPresentQuality(viewportId) ??
        FUBERLIN_DEFAULT_PRESENT_QUALITY
    );
    setProfiles(readProfiles(viewportId));
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
      setProfiles(readProfiles(viewportId));
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
          <div className="text-muted-foreground mt-1 space-y-0.5 px-2 text-xs">
            <div>{quality.toFixed(2)}</div>
            {profiles && (
              <>
                <div>{formatProfileLine('still', profiles.still)}</div>
                <div>{formatProfileLine('drag', profiles.interactive)}</div>
              </>
            )}
          </div>
        </Numeric.Container>
      </div>
    </div>
  );
}
