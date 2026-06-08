import {
  getSupportedQualityModesForTask,
  TOTAL_SEGMENTATOR_TASKS,
  type TotalSegmentatorQuality,
} from './total-segmentator-tasks';

export interface TotalSegmentatorOptions {
  task: string;
  quality: TotalSegmentatorQuality;
  /** null = create new segment group on apply (Slicer OutputSegmentation none). */
  outputSegmentGroupId: string | null;
  useStandardSegmentNames: boolean;
  cpu: boolean;
  robustCrop: boolean;
  removeSmallBlobs: boolean;
  higherOrderResampling: boolean;
}

export const DEFAULT_TOTAL_SEGMENTATOR_OPTIONS: TotalSegmentatorOptions = {
  task: 'total',
  quality: 'normal',
  outputSegmentGroupId: null,
  useStandardSegmentNames: true,
  cpu: false,
  robustCrop: false,
  removeSmallBlobs: false,
  higherOrderResampling: false,
};

function clampQualityForTask(
  task: string,
  quality: TotalSegmentatorQuality
): TotalSegmentatorQuality {
  const supported = getSupportedQualityModesForTask(task);
  if (supported.includes(quality)) {
    return quality;
  }
  return supported[0];
}

export function normalizeTotalSegmentatorOptions(
  partial: Partial<TotalSegmentatorOptions> = {}
): TotalSegmentatorOptions {
  const requestedTask = partial.task ?? DEFAULT_TOTAL_SEGMENTATOR_OPTIONS.task;
  const resolvedTask =
    requestedTask in TOTAL_SEGMENTATOR_TASKS
      ? requestedTask
      : DEFAULT_TOTAL_SEGMENTATOR_OPTIONS.task;

  return {
    task: resolvedTask,
    quality: clampQualityForTask(
      resolvedTask,
      partial.quality ?? DEFAULT_TOTAL_SEGMENTATOR_OPTIONS.quality
    ),
    outputSegmentGroupId:
      partial.outputSegmentGroupId !== undefined
        ? partial.outputSegmentGroupId
        : DEFAULT_TOTAL_SEGMENTATOR_OPTIONS.outputSegmentGroupId,
    useStandardSegmentNames:
      partial.useStandardSegmentNames ??
      DEFAULT_TOTAL_SEGMENTATOR_OPTIONS.useStandardSegmentNames,
    cpu: partial.cpu ?? DEFAULT_TOTAL_SEGMENTATOR_OPTIONS.cpu,
    robustCrop: partial.robustCrop ?? DEFAULT_TOTAL_SEGMENTATOR_OPTIONS.robustCrop,
    removeSmallBlobs:
      partial.removeSmallBlobs ??
      DEFAULT_TOTAL_SEGMENTATOR_OPTIONS.removeSmallBlobs,
    higherOrderResampling:
      partial.higherOrderResampling ??
      DEFAULT_TOTAL_SEGMENTATOR_OPTIONS.higherOrderResampling,
  };
}
