import React, { ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import {
  getSlicerLiveVolume3D,
  getSlicerLiveVolume3DAccumulate,
  getSlicerLiveVolume3DAutoSampleStep,
  getSlicerLiveVolume3DSampleStep,
  getSlicerLiveVolume3DSettleSamples,
  getSlicerLiveVolume3DTargetMs,
} from '@cornerstonejs/core';
import { Numeric, Switch, ToggleGroup, ToggleGroupItem } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { useTranslation } from 'react-i18next';

const TARGET_MS_OPTIONS = [8, 16, 33] as const;
const DEFAULT_SETTLE_SAMPLES = 32;

function sectionHeader(label: string): ReactElement {
  return (
    <>
      <div className="mt-2 flex h-8 !h-[20px] w-full flex-shrink-0 items-center justify-start px-2 text-base">
        <div className="text-muted-foreground text-sm">{label}</div>
      </div>
      <div className="bg-background mt-1 mb-1 h-px w-full"></div>
    </>
  );
}

/**
 * SlicerLive performance controls (Sample step / Motion / Settle).
 * Appearance stays under Rendering Options.
 */
export function SlicerLiveOptions({
  viewportId,
}: {
  viewportId?: string;
} = {}): ReactElement | null {
  const { t } = useTranslation('WindowLevelActionMenu');
  const { commandsManager } = useSystem();
  const isSlicerLive = Boolean(viewportId && getSlicerLiveVolume3D(viewportId));

  const [targetMs, setTargetMs] = useState(() =>
    viewportId && isSlicerLive
      ? (getSlicerLiveVolume3DTargetMs(viewportId) ?? 16)
      : 16
  );
  const autoSampleStep =
    (viewportId && isSlicerLive
      ? getSlicerLiveVolume3DAutoSampleStep(viewportId)
      : undefined) ?? 1;
  const [sampleStep, setSampleStep] = useState(() =>
    viewportId && isSlicerLive
      ? (getSlicerLiveVolume3DSampleStep(viewportId) ?? autoSampleStep)
      : autoSampleStep
  );
  const [accumulate, setAccumulate] = useState(() =>
    viewportId && isSlicerLive
      ? (getSlicerLiveVolume3DAccumulate(viewportId) ?? true)
      : true
  );
  const [settleSamples, setSettleSamples] = useState(() =>
    viewportId && isSlicerLive
      ? (getSlicerLiveVolume3DSettleSamples(viewportId) ?? DEFAULT_SETTLE_SAMPLES)
      : DEFAULT_SETTLE_SAMPLES
  );

  useEffect(() => {
    if (!viewportId || !isSlicerLive) {
      return;
    }
    setTargetMs(getSlicerLiveVolume3DTargetMs(viewportId) ?? 16);
    setSampleStep(
      getSlicerLiveVolume3DSampleStep(viewportId) ??
        getSlicerLiveVolume3DAutoSampleStep(viewportId) ??
        1
    );
    setAccumulate(getSlicerLiveVolume3DAccumulate(viewportId) ?? true);
    setSettleSamples(
      getSlicerLiveVolume3DSettleSamples(viewportId) ?? DEFAULT_SETTLE_SAMPLES
    );
  }, [viewportId, isSlicerLive]);

  const sampleStepRange = useMemo(() => {
    const mid = Math.max(0.1, autoSampleStep);
    return {
      min: Math.max(0.05, mid * 0.25),
      max: Math.max(mid * 4, mid + 0.5),
      step: Math.max(0.01, mid * 0.05),
    };
  }, [autoSampleStep]);

  const onTargetMs = useCallback(
    (next: string) => {
      if (!viewportId || !next) {
        return;
      }
      const ms = Number(next);
      setTargetMs(ms);
      commandsManager.runCommand('setSlicerLiveVolumeTargetMs', {
        viewportId,
        targetMs: ms,
      });
    },
    [commandsManager, viewportId]
  );

  const onSampleStep = useCallback(
    (value: number) => {
      if (!viewportId) {
        return;
      }
      setSampleStep(value);
      commandsManager.runCommand('setSlicerLiveVolumeSampleStep', {
        viewportId,
        stepMm: value,
      });
    },
    [commandsManager, viewportId]
  );

  const onAccumulate = useCallback(
    (checked: boolean) => {
      if (!viewportId) {
        return;
      }
      setAccumulate(checked);
      commandsManager.runCommand('setSlicerLiveVolumeAccumulate', {
        viewportId,
        accumulate: checked,
      });
    },
    [commandsManager, viewportId]
  );

  const onSettleSamples = useCallback(
    (value: number) => {
      if (!viewportId) {
        return;
      }
      setSettleSamples(value);
      commandsManager.runCommand('setSlicerLiveVolumeSettleSamples', {
        viewportId,
        count: value,
      });
    },
    [commandsManager, viewportId]
  );

  if (!isSlicerLive || !viewportId) {
    return null;
  }

  return (
    <div className="flex w-full flex-col pb-2">
      <div className="my-1 mt-2 w-full pl-2 pr-1">
        <Numeric.Container
          mode="singleRange"
          min={sampleStepRange.min}
          max={sampleStepRange.max}
          step={sampleStepRange.step}
          value={sampleStep}
          onChange={onSampleStep}
        >
          <div className="flex flex-row items-center">
            <Numeric.Label className="w-24">{t('Sample step')}</Numeric.Label>
            <Numeric.SingleRange sliderClassName="mx-2 flex-grow" />
          </div>
          <div className="text-muted-foreground mt-1 px-2 text-xs">
            {sampleStep.toFixed(3)} mm
          </div>
        </Numeric.Container>
      </div>

      {sectionHeader(t('Motion'))}
      <div className="mb-2 flex w-full flex-col gap-1 px-2">
        <div className="text-muted-foreground text-sm">{t('Target ms')}</div>
        <ToggleGroup
          type="single"
          value={String(targetMs)}
          onValueChange={onTargetMs}
          className="grid w-full grid-cols-3 gap-1"
        >
          {TARGET_MS_OPTIONS.map(ms => (
            <ToggleGroupItem
              key={ms}
              value={String(ms)}
              size="sm"
              className="px-1 text-xs"
            >
              {ms}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {sectionHeader(t('Settle'))}
      <div className="hover:bg-accent flex h-8 w-full flex-shrink-0 items-center px-2 text-base hover:rounded">
        <span className="flex-grow">{t('Accumulate')}</span>
        <Switch
          className="ml-2 flex-shrink-0"
          checked={accumulate}
          onCheckedChange={onAccumulate}
        />
      </div>
      <div className={`my-1 w-full pl-2 pr-1 ${accumulate ? '' : 'ohif-disabled !opacity-40'}`}>
        <Numeric.Container
          mode="singleRange"
          min={1}
          max={64}
          step={1}
          value={settleSamples}
          onChange={onSettleSamples}
        >
          <div className="flex flex-row items-center">
            <Numeric.Label className="w-24">{t('Settle samples')}</Numeric.Label>
            <Numeric.SingleRange sliderClassName="mx-2 flex-grow" />
          </div>
          <div className="text-muted-foreground mt-1 px-2 text-xs">{settleSamples}</div>
        </Numeric.Container>
      </div>
    </div>
  );
}
