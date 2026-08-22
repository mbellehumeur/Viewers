import React, { ReactElement, useCallback, useEffect, useState } from 'react';
import {
  MVIEW_DEFAULT_MIN_BUDGET_PX,
  MVIEW_DEFAULT_TARGET_FPS,
  MVIEW_MIN_BUDGET_PX_CEILING,
  MVIEW_MIN_BUDGET_PX_FLOOR,
  getMviewVolume3D,
  getMviewVolume3DMinBudgetPx,
  getMviewVolume3DRenderMode,
  getMviewVolume3DTargetFps,
  getMviewVolume3DTargetFpsEnabled,
  type MviewVolume3DRenderMode as MviewMode,
} from '@cornerstonejs/core';
import { Numeric, Switch } from '@ohif/ui-next';
import { useSystem } from '@ohif/core';
import { useTranslation } from 'react-i18next';
import { MviewVolumePresentQuality } from './MviewVolumePresentQuality';

const TARGET_FPS_MAX = 60;
const MIN_BUDGET_STEP_PX = 10_000;

type TargetFpsDecision = {
  lastDragAvgFps: number;
  lastDragFrames: number;
  lastDragBudgetFrom: number;
  lastDragBudgetTo: number;
  lastDragScale: number;
  lastDragSteps: number;
  budgetPx: number;
};

function formatBudgetPx(pixels: number): string {
  if (pixels >= 1_000_000) {
    return `${(pixels / 1_000_000).toFixed(1)}M`;
  }
  if (pixels >= 1_000) {
    return `${Math.round(pixels / 1_000)}k`;
  }
  return `${Math.round(pixels)}`;
}

function readTargetFpsDecision(viewportId: string): TargetFpsDecision | undefined {
  const entry = getMviewVolume3D(viewportId);
  const stats = entry?.renderer?.getStats?.();
  if (!stats) {
    return undefined;
  }
  return {
    lastDragAvgFps: Number(stats.lastDragAvgFps) || 0,
    lastDragFrames: Number(stats.lastDragFrames) || 0,
    lastDragBudgetFrom: Number(stats.lastDragBudgetFrom) || 0,
    lastDragBudgetTo: Number(stats.lastDragBudgetTo) || 0,
    lastDragScale: Number(stats.lastDragScale) || 0,
    lastDragSteps: Number(stats.lastDragSteps) || 0,
    budgetPx: Number(stats.budgetPx) || 0,
  };
}

/**
 * mview performance controls (Target FPS / Resolution).
 * Resolution is shown only when Target FPS is off.
 * Appearance stays under Rendering Options.
 */
export function MviewOptions({
  viewportId,
}: {
  viewportId?: string;
} = {}): ReactElement | null {
  const { t } = useTranslation('WindowLevelActionMenu');
  const { commandsManager } = useSystem();
  const isMview = Boolean(viewportId && getMviewVolume3D(viewportId));
  const [enabled, setEnabled] = useState(() =>
    viewportId && isMview
      ? (getMviewVolume3DTargetFpsEnabled(viewportId) ?? true)
      : true
  );
  const [targetFps, setTargetFps] = useState(() =>
    viewportId && isMview
      ? (getMviewVolume3DTargetFps(viewportId) ?? MVIEW_DEFAULT_TARGET_FPS)
      : MVIEW_DEFAULT_TARGET_FPS
  );
  const [minBudgetPx, setMinBudgetPx] = useState(() =>
    viewportId && isMview
      ? (getMviewVolume3DMinBudgetPx(viewportId) ?? MVIEW_DEFAULT_MIN_BUDGET_PX)
      : MVIEW_DEFAULT_MIN_BUDGET_PX
  );
  const [mviewMode, setMviewMode] = useState<MviewMode | undefined>(() =>
    viewportId && isMview
      ? (getMviewVolume3DRenderMode(viewportId) ?? 'composite')
      : undefined
  );
  const [decision, setDecision] = useState<TargetFpsDecision | undefined>(() =>
    viewportId && isMview ? readTargetFpsDecision(viewportId) : undefined
  );

  useEffect(() => {
    if (!viewportId || !isMview) {
      return;
    }
    setEnabled(getMviewVolume3DTargetFpsEnabled(viewportId) ?? true);
    setTargetFps(
      getMviewVolume3DTargetFps(viewportId) ?? MVIEW_DEFAULT_TARGET_FPS
    );
    setMinBudgetPx(
      getMviewVolume3DMinBudgetPx(viewportId) ?? MVIEW_DEFAULT_MIN_BUDGET_PX
    );
    setMviewMode(getMviewVolume3DRenderMode(viewportId) ?? 'composite');
    setDecision(readTargetFpsDecision(viewportId));
  }, [viewportId, isMview]);

  useEffect(() => {
    if (!viewportId || !isMview || !enabled) {
      return;
    }
    setDecision(readTargetFpsDecision(viewportId));
    const timer = window.setInterval(() => {
      setDecision(readTargetFpsDecision(viewportId));
    }, 200);
    return () => window.clearInterval(timer);
  }, [viewportId, isMview, enabled]);

  const onEnabled = useCallback(
    (checked: boolean) => {
      if (!viewportId) {
        return;
      }
      setEnabled(checked);
      commandsManager.runCommand('setMviewVolumeTargetFpsEnabled', {
        viewportId,
        enabled: checked,
      });
      setDecision(readTargetFpsDecision(viewportId));
    },
    [commandsManager, viewportId]
  );

  const onTargetFps = useCallback(
    (value: number | [number, number]) => {
      if (!viewportId) {
        return;
      }
      const raw = Array.isArray(value) ? value[0] : value;
      const next = Math.max(1, Math.round(raw));
      setTargetFps(next);
      commandsManager.runCommand('setMviewVolumeTargetFps', {
        viewportId,
        fps: next,
      });
      setDecision(readTargetFpsDecision(viewportId));
    },
    [commandsManager, viewportId]
  );

  const onMinBudgetPx = useCallback(
    (value: number | [number, number]) => {
      if (!viewportId) {
        return;
      }
      const raw = Array.isArray(value) ? value[0] : value;
      const next = Math.min(
        MVIEW_MIN_BUDGET_PX_CEILING,
        Math.max(
          MVIEW_MIN_BUDGET_PX_FLOOR,
          Math.round(raw / MIN_BUDGET_STEP_PX) * MIN_BUDGET_STEP_PX
        )
      );
      setMinBudgetPx(next);
      commandsManager.runCommand('setMviewVolumeMinBudgetPx', {
        viewportId,
        minPx: next,
      });
      setDecision(readTargetFpsDecision(viewportId));
    },
    [commandsManager, viewportId]
  );

  if (!isMview || !viewportId) {
    return null;
  }

  return (
    <div className="flex w-full flex-col pb-2">
      <div className="hover:bg-accent flex h-8 w-full flex-shrink-0 items-center px-2 text-base hover:rounded">
        <span className="flex-grow">{t('Target FPS')}</span>
        <Switch
          className="ml-2 flex-shrink-0"
          checked={enabled}
          onCheckedChange={onEnabled}
        />
      </div>
      <div
        className={`my-1 w-full pl-2 pr-1 ${enabled ? '' : 'ohif-disabled !opacity-40'}`}
      >
        <Numeric.Container
          mode="singleRange"
          min={1}
          max={TARGET_FPS_MAX}
          step={1}
          value={targetFps}
          onChange={onTargetFps}
        >
          <div className="flex flex-row items-center">
            <Numeric.Label className="w-16">{t('FPS')}</Numeric.Label>
            <Numeric.SingleRange sliderClassName="mx-2 flex-grow" />
          </div>
          <div className="text-muted-foreground mt-1 space-y-0.5 px-2 text-xs">
            <div>{targetFps}</div>
            {enabled && decision && (
              <>
                {decision.lastDragAvgFps > 0 ? (
                  <>
                    <div>
                      sample {decision.lastDragAvgFps.toFixed(1)} fps ·{' '}
                      {decision.lastDragFrames} frames
                    </div>
                    <div>
                      budget {formatBudgetPx(decision.lastDragBudgetFrom)} →{' '}
                      {formatBudgetPx(decision.lastDragBudgetTo)}
                    </div>
                    <div>
                      drag scale {decision.lastDragScale.toFixed(2)} ·{' '}
                      {decision.lastDragSteps} steps
                    </div>
                  </>
                ) : decision.lastDragFrames > 0 ? (
                  <div>
                    sample: not enough frames ({decision.lastDragFrames})
                  </div>
                ) : (
                  <div>drag to adapt FPS</div>
                )}
              </>
            )}
          </div>
        </Numeric.Container>
        <Numeric.Container
          mode="singleRange"
          min={MVIEW_MIN_BUDGET_PX_FLOOR}
          max={MVIEW_MIN_BUDGET_PX_CEILING}
          step={MIN_BUDGET_STEP_PX}
          value={minBudgetPx}
          onChange={onMinBudgetPx}
        >
          <div className="mt-3 flex flex-row items-center">
            <Numeric.Label className="w-16">{t('Min budget')}</Numeric.Label>
            <Numeric.SingleRange sliderClassName="mx-2 flex-grow" />
          </div>
          <div className="text-muted-foreground mt-1 px-2 text-xs">
            {formatBudgetPx(minBudgetPx)} px floor
          </div>
        </Numeric.Container>
      </div>
      {!enabled && (
        <MviewVolumePresentQuality
          viewportId={viewportId}
          renderMode={mviewMode}
        />
      )}
    </div>
  );
}
