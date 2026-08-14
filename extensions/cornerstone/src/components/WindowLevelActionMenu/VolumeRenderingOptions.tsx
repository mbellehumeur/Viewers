import React, { ReactElement, useState } from 'react';
import { AllInOneMenu } from '@ohif/ui-next';
import {
  getFuberlinVolume3D,
  getFuberlinVolume3DRenderMode,
  getMviewVolume3D,
  getMviewVolume3DRenderMode,
  getSlicerLiveVolume3D,
  getSlicerLiveVolume3DShade,
  type FuberlinVolume3DRenderMode as FuberlinMode,
  type MviewVolume3DRenderMode as MviewMode,
} from '@cornerstonejs/core';
import { VolumeRenderingQuality } from './VolumeRenderingQuality';
import { VolumeShift } from './VolumeShift';
import { VolumeLighting } from './VolumeLighting';
import { VolumeShade } from './VolumeShade';
import { FuberlinVolumeRenderMode } from './FuberlinVolumeRenderMode';
import { FuberlinVolumeProjection } from './FuberlinVolumeProjection';
import { FuberlinVolumePresentQuality } from './FuberlinVolumePresentQuality';
import { FuberlinVolumeThreshold } from './FuberlinVolumeThreshold';
import { MviewVolumeRenderMode } from './MviewVolumeRenderMode';
import { MviewVolumeProjection } from './MviewVolumeProjection';
import { MviewVolumeThreshold } from './MviewVolumeThreshold';
import { SlicerLiveVolumeShade } from './SlicerLiveVolumeShade';
import { SlicerLiveVolumeLighting } from './SlicerLiveVolumeLighting';
import { SlicerLiveVolumeOpacity } from './SlicerLiveVolumeOpacity';
import { useViewportRendering } from '../../hooks/useViewportRendering';
import { useTranslation } from 'react-i18next';

export function VolumeRenderingOptions({ viewportId }: { viewportId?: string } = {}): ReactElement {
  const { volumeRenderingQualityRange } = useViewportRendering(viewportId);
  const [hasShade, setShade] = useState(false);
  const { t } = useTranslation('WindowLevelActionMenu');
  // Sync — deferred detection left VTK controls mounted for one frame and crashed.
  const isSlicerLive = Boolean(viewportId && getSlicerLiveVolume3D(viewportId));
  const isMview = Boolean(viewportId && getMviewVolume3D(viewportId));
  const isFuberlin = Boolean(viewportId && getFuberlinVolume3D(viewportId));
  const [slicerLiveShade, setSlicerLiveShade] = useState(() =>
    viewportId && isSlicerLive ? (getSlicerLiveVolume3DShade(viewportId) ?? true) : true
  );
  const [mviewMode, setMviewMode] = useState<MviewMode | undefined>(() =>
    viewportId && isMview
      ? (getMviewVolume3DRenderMode(viewportId) ?? 'composite')
      : undefined
  );
  const [fuberlinMode, setFuberlinMode] = useState<FuberlinMode | undefined>(() =>
    viewportId && isFuberlin
      ? (getFuberlinVolume3DRenderMode(viewportId) ?? 'composite')
      : undefined
  );

  return (
    <AllInOneMenu.ItemPanel>
      {isSlicerLive && (
        <>
          <div className="mt-2 flex h-8 !h-[20px] w-full flex-shrink-0 items-center justify-start px-2 text-base">
            <div className="text-muted-foreground text-sm">{t('Volume')}</div>
          </div>
          <div className="bg-background mt-1 mb-1 h-px w-full"></div>
          <SlicerLiveVolumeOpacity viewportId={viewportId} />
          <div className="mt-2 flex h-8 !h-[20px] w-full flex-shrink-0 items-center justify-start px-2 text-base">
            <div className="text-muted-foreground text-sm">{t('Lighting')}</div>
          </div>
          <div className="bg-background mt-1 mb-1 h-px w-full"></div>
          <SlicerLiveVolumeShade
            viewportId={viewportId}
            onShadeChange={setSlicerLiveShade}
          />
          <SlicerLiveVolumeLighting
            viewportId={viewportId}
            hasShade={slicerLiveShade}
          />
        </>
      )}
      {!isSlicerLive && isMview && (
        <>
          <MviewVolumeRenderMode
            viewportId={viewportId}
            onModeChange={setMviewMode}
          />
          <MviewVolumeProjection viewportId={viewportId} />
          <MviewVolumeThreshold
            viewportId={viewportId}
            renderMode={mviewMode}
          />
        </>
      )}
      {!isSlicerLive && !isMview && isFuberlin && (
        <>
          <FuberlinVolumeRenderMode
            viewportId={viewportId}
            onModeChange={setFuberlinMode}
          />
          <FuberlinVolumeProjection viewportId={viewportId} />
          <FuberlinVolumePresentQuality
            viewportId={viewportId}
            renderMode={fuberlinMode}
          />
          <FuberlinVolumeThreshold
            viewportId={viewportId}
            renderMode={fuberlinMode}
          />
        </>
      )}
      {!isSlicerLive && !isMview && !isFuberlin && (
        <>
          <VolumeRenderingQuality
            viewportId={viewportId}
            volumeRenderingQualityRange={volumeRenderingQualityRange}
          />
          <VolumeShift viewportId={viewportId} />
          <div className="mt-2 flex h-8 !h-[20px] w-full flex-shrink-0 items-center justify-start px-2 text-base">
            <div className="text-muted-foreground text-sm">{t('Lighting')}</div>
          </div>
          <div className="bg-background mt-1 mb-1 h-px w-full"></div>
          <div className="hover:bg-accent flex h-8 w-full flex-shrink-0 items-center px-2 text-base hover:rounded">
            <VolumeShade
              viewportId={viewportId}
              onClickShade={setShade}
            />
          </div>
          <VolumeLighting
            viewportId={viewportId}
            hasShade={hasShade}
          />
        </>
      )}
    </AllInOneMenu.ItemPanel>
  );
}
