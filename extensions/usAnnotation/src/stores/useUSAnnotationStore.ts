import { create } from 'zustand';
import {
  extractRatersFromFrames,
  mergeImportedFrames,
  type FrameAnnotation,
  type USAnnotationRatingFile,
} from '../utils/usAnnotationJson';

type USAnnotationStoreState = {
  merged: USAnnotationRatingFile | null;
  selectedRater: string;
  raters: string[];

  mergeImport: (parsed: USAnnotationRatingFile) => { importedRaters: string[] };
  setSelectedRater: (rater: string) => void;
  addRater: (rater: string) => void;
  setMergedFrames: (frames: FrameAnnotation[]) => void;
  updateMergedMetadata: (metadata: Partial<USAnnotationRatingFile>) => void;
  reset: () => void;
  getMergedFrames: () => FrameAnnotation[];
  getAnnotationLabels: () => string[];
};

const initialState = {
  merged: null as USAnnotationRatingFile | null,
  selectedRater: '',
  raters: [] as string[],
};

const EMPTY_FRAME_ANNOTATIONS: FrameAnnotation[] = [];

export const useUSAnnotationStore = create<USAnnotationStoreState>((set, get) => ({
  ...initialState,

  mergeImport: parsed => {
    const { merged, selectedRater } = get();
    const existingFrames = merged?.frame_annotations ?? [];
    const mergedFrames = mergeImportedFrames(existingFrames, parsed.frame_annotations);
    const importedRaters = extractRatersFromFrames(parsed.frame_annotations);
    const raters = extractRatersFromFrames(mergedFrames);
    const nextSelectedRater = importedRaters[0] ?? selectedRater ?? raters[0] ?? '';

    set({
      merged: {
        ...(merged ?? {}),
        frame_annotations: mergedFrames,
        SOPInstanceUID: parsed.SOPInstanceUID ?? merged?.SOPInstanceUID,
        GrayscaleConversion: parsed.GrayscaleConversion ?? merged?.GrayscaleConversion,
        mask_type: parsed.mask_type ?? merged?.mask_type,
        angle1: parsed.angle1 ?? merged?.angle1,
        angle2: parsed.angle2 ?? merged?.angle2,
        center_rows_px: parsed.center_rows_px ?? merged?.center_rows_px,
        center_cols_px: parsed.center_cols_px ?? merged?.center_cols_px,
        radius1: parsed.radius1 ?? merged?.radius1,
        radius2: parsed.radius2 ?? merged?.radius2,
        image_size_rows: parsed.image_size_rows ?? merged?.image_size_rows,
        image_size_cols: parsed.image_size_cols ?? merged?.image_size_cols,
        AnnotationLabels: parsed.AnnotationLabels?.length
          ? parsed.AnnotationLabels
          : merged?.AnnotationLabels ?? [],
        labels: parsed.labels?.length ? parsed.labels : merged?.labels ?? [],
      },
      raters,
      selectedRater: nextSelectedRater,
    });

    return { importedRaters };
  },

  setSelectedRater: rater => {
    set({ selectedRater: rater.trim().toLowerCase() });
  },

  addRater: rater => {
    const normalized = rater.trim().toLowerCase();
    if (!normalized) {
      return;
    }
    const { raters } = get();
    if (!raters.includes(normalized)) {
      set({ raters: [...raters, normalized].sort(), selectedRater: normalized });
    } else {
      set({ selectedRater: normalized });
    }
  },

  setMergedFrames: frames => {
    const { merged } = get();
    const raters = extractRatersFromFrames(frames);
    set({
      merged: merged ? { ...merged, frame_annotations: frames } : { frame_annotations: frames },
      raters,
    });
  },

  updateMergedMetadata: metadata => {
    const { merged } = get();
    set({
      merged: {
        ...(merged ?? { frame_annotations: [] }),
        ...metadata,
      },
    });
  },

  reset: () => set(initialState),

  getMergedFrames: () => get().merged?.frame_annotations ?? EMPTY_FRAME_ANNOTATIONS,

  getAnnotationLabels: () => get().merged?.AnnotationLabels ?? [],
}));

export function getUSAnnotationStoreState() {
  return useUSAnnotationStore.getState();
}
