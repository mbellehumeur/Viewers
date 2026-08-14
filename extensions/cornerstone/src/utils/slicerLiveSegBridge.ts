import {
  beginSlicerLiveVolume3DSegmentation,
  cache,
  clearSlicerLiveVolume3DSegmentation,
  finalizeSlicerLiveVolume3DSegmentation,
  getSlicerLiveVolume3D,
  metaData,
  setSlicerLiveVolume3DSegmentAppearance,
  setSlicerLiveVolume3DSegmentation,
  updateSlicerLiveVolume3DSegmentationSlices,
} from '@cornerstonejs/core';

type SegmentationServiceLike = {
  getLabelmapVolume: (segmentationId: string) => {
    dimensions?: number[];
    spacing?: number[];
    origin?: number[];
    direction?: number[] | Float32Array;
    imageData?: {
      getDimensions?: () => number[];
      getSpacing?: () => number[];
      getOrigin?: () => number[];
      getDirection?: () => number[];
    };
    voxelManager?: {
      getCompleteScalarDataArray?: () => ArrayLike<number>;
      getScalarData?: () => ArrayLike<number>;
    };
  } | null;
  getSegmentation: (segmentationId: string) =>
    | {
        segments?: Record<
          string,
          {
            segmentIndex?: number;
            label?: string;
          }
        >;
        representationData?: {
          Labelmap?: {
            volumeId?: string;
            imageIds?: string[];
            referencedImageIds?: string[];
            labelmaps?: Record<
              string,
              {
                imageIds?: string[];
                referencedImageIds?: string[];
              }
            >;
          };
        };
      }
    | undefined;
  getSegmentColor: (
    viewportId: string,
    segmentationId: string,
    segmentIndex: number
  ) => number[] | undefined;
  getSegmentationRepresentations?: (
    viewportId: string,
    specifier?: { segmentationId?: string; type?: unknown }
  ) => Array<{
    type?: string;
    visible?: boolean;
    segments?: Record<
      string | number,
      { visible?: boolean; segmentIndex?: number }
    >;
  }>;
};

type LabelmapBundle = {
  lab: Uint8Array;
  dimensions: [number, number, number];
  ijkToWorld: number[];
};

function buildIjkToWorld(
  origin: [number, number, number],
  spacing: [number, number, number],
  direction?: number[] | ArrayLike<number>
): number[] {
  const d =
    direction && direction.length >= 9
      ? direction
      : ([1, 0, 0, 0, 1, 0, 0, 0, 1] as const);
  const [sx, sy, sz] = spacing;
  return [
    Number(d[0]) * sx,
    Number(d[3]) * sy,
    Number(d[6]) * sz,
    origin[0],
    Number(d[1]) * sx,
    Number(d[4]) * sy,
    Number(d[7]) * sz,
    origin[1],
    Number(d[2]) * sx,
    Number(d[5]) * sy,
    Number(d[8]) * sz,
    origin[2],
    0,
    0,
    0,
    1,
  ];
}

function toUint8Labelmap(scalars: ArrayLike<number>, length: number): Uint8Array {
  const lab = new Uint8Array(length);
  const n = Math.min(length, scalars.length);
  for (let i = 0; i < n; i++) {
    const v = Number(scalars[i]);
    if (!Number.isFinite(v) || v <= 0) {
      continue;
    }
    lab[i] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return lab;
}

function getSopInstanceUID(imageId: string | undefined): string | undefined {
  if (!imageId) {
    return undefined;
  }
  const sopCommon = metaData.get('sopCommonModule', imageId) as
    | { sopInstanceUID?: string }
    | undefined;
  if (sopCommon?.sopInstanceUID) {
    return sopCommon.sopInstanceUID;
  }
  const generalImage = metaData.get('generalImageModule', imageId) as
    | { sopInstanceUID?: string }
    | undefined;
  if (generalImage?.sopInstanceUID) {
    return generalImage.sopInstanceUID;
  }
  const instance = metaData.get('instance', imageId) as
    | { SOPInstanceUID?: string; SopInstanceUID?: string }
    | undefined;
  return instance?.SOPInstanceUID ?? instance?.SopInstanceUID;
}

type CachedVolumeLike = {
  dimensions?: number[];
  spacing?: number[];
  origin?: number[];
  direction?: number[] | Float32Array;
  imageIds?: string[];
};

function findMatchingVolume(
  dims: [number, number, number],
  referencedImageIds: string[]
): CachedVolumeLike | undefined {
  const volumes = cache.getVolumes?.() ?? [];
  const firstRef = referencedImageIds[0];
  return volumes.find(v => {
    if (!v?.dimensions || !v?.spacing) {
      return false;
    }
    const sameGrid =
      v.dimensions[0] === dims[0] &&
      v.dimensions[1] === dims[1] &&
      v.dimensions[2] === dims[2];
    if (!sameGrid) {
      return Boolean(firstRef && v.imageIds?.includes?.(firstRef));
    }
    return true;
  });
}

/**
 * Build srcSlice -> destSlice so packed SEG frames land on the same k as the
 * matching CT volume.imageIds. Identity when orders already match.
 */
function sliceIndexMapToVolume(
  sourceImageIds: Array<string | undefined>,
  volumeImageIds: string[] | undefined,
  depth: number
): number[] | undefined {
  if (!volumeImageIds?.length || volumeImageIds.length !== depth) {
    return undefined;
  }

  const byId = new Map<string, number>();
  const bySop = new Map<string, number>();
  for (let i = 0; i < volumeImageIds.length; i++) {
    const id = volumeImageIds[i];
    byId.set(id, i);
    const sop = getSopInstanceUID(id);
    if (sop) {
      bySop.set(sop, i);
    }
  }

  const srcToDst = new Array<number>(depth).fill(-1);
  let mapped = 0;
  for (let src = 0; src < depth; src++) {
    const refId = sourceImageIds[src];
    if (!refId) {
      continue;
    }
    let dst = byId.get(refId);
    if (dst === undefined) {
      const sop = getSopInstanceUID(refId);
      dst = sop ? bySop.get(sop) : undefined;
    }
    if (dst === undefined) {
      dst = volumeImageIds.findIndex(
        id => id === refId || id.includes(refId) || refId.includes(id)
      );
      if (dst < 0) {
        continue;
      }
    }
    if (dst >= 0 && dst < depth) {
      srcToDst[src] = dst;
      mapped += 1;
    }
  }

  if (mapped < 2) {
    return undefined;
  }

  let identity = true;
  for (let src = 0; src < depth; src++) {
    const dst = srcToDst[src];
    if (dst >= 0 && dst !== src) {
      identity = false;
      break;
    }
  }
  if (identity) {
    return undefined;
  }

  return srcToDst;
}

function permuteLabelmapSlices(
  lab: Uint8Array,
  dims: [number, number, number],
  srcToDst: number[]
): Uint8Array {
  const sliceLen = dims[0] * dims[1];
  const depth = dims[2];
  const out = new Uint8Array(lab.length);
  for (let src = 0; src < depth; src++) {
    const dst = srcToDst[src];
    if (dst < 0 || dst >= depth) {
      continue;
    }
    out.set(lab.subarray(src * sliceLen, (src + 1) * sliceLen), dst * sliceLen);
  }
  return out;
}

function remapLoadedSliceIndices(indices: number[], srcToDst: number[]): number[] {
  const remapped: number[] = [];
  for (const src of indices) {
    const dst = srcToDst[src];
    if (dst !== undefined && dst >= 0) {
      remapped.push(dst);
    }
  }
  return remapped;
}

function alignLabelmapWithVolume(
  lab: Uint8Array,
  dims: [number, number, number],
  referencedImageIds: string[],
  volume?: CachedVolumeLike
): { lab: Uint8Array; sliceIndexMap?: number[] } {
  const match = volume ?? findMatchingVolume(dims, referencedImageIds);
  if (
    !match?.imageIds?.length ||
    match.dimensions?.[0] !== dims[0] ||
    match.dimensions?.[1] !== dims[1] ||
    match.dimensions?.[2] !== dims[2]
  ) {
    return { lab };
  }

  const srcToDst = sliceIndexMapToVolume(referencedImageIds, match.imageIds, dims[2]);
  if (!srcToDst) {
    return { lab };
  }

  return { lab: permuteLabelmapSlices(lab, dims, srcToDst), sliceIndexMap: srcToDst };
}

function rgbaToUnitRgb(color: number[] | undefined): [number, number, number] | null {
  if (!color || color.length < 3) {
    return null;
  }
  const scale = color[0] > 1 || color[1] > 1 || color[2] > 1 ? 1 / 255 : 1;
  return [color[0] * scale, color[1] * scale, color[2] * scale];
}

function defaultSegmentColor(segmentIndex: number): [number, number, number] {
  const hue = (segmentIndex * 0.61803398875) % 1;
  const s = 0.75;
  const v = 0.9;
  const i = Math.floor(hue * 6);
  const f = hue * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

function labelmapFromVolume(labelmapVolume: NonNullable<
  ReturnType<SegmentationServiceLike['getLabelmapVolume']>
>): LabelmapBundle | null {
  const dimensions = (labelmapVolume.dimensions ??
    labelmapVolume.imageData?.getDimensions?.()) as
    | [number, number, number]
    | undefined;
  const spacing = (labelmapVolume.spacing ??
    labelmapVolume.imageData?.getSpacing?.()) as
    | [number, number, number]
    | undefined;
  const origin = (labelmapVolume.origin ??
    labelmapVolume.imageData?.getOrigin?.() ?? [0, 0, 0]) as [
    number,
    number,
    number,
  ];
  const direction =
    labelmapVolume.direction ?? labelmapVolume.imageData?.getDirection?.();

  if (!dimensions || !spacing) {
    return null;
  }

  const expected = dimensions[0] * dimensions[1] * dimensions[2];
  const scalars =
    labelmapVolume.voxelManager?.getCompleteScalarDataArray?.() ??
    labelmapVolume.voxelManager?.getScalarData?.();

  if (!scalars || scalars.length === 0) {
    return null;
  }

  return {
    lab: toUint8Labelmap(scalars, expected),
    dimensions,
    ijkToWorld: buildIjkToWorld(origin, spacing, direction),
  };
}

function collectStackLabelmapImageIds(
  segmentation: NonNullable<ReturnType<SegmentationServiceLike['getSegmentation']>>
): string[] {
  const labelmap = segmentation.representationData?.Labelmap;
  if (!labelmap) {
    return [];
  }

  if (labelmap.imageIds?.length) {
    return labelmap.imageIds;
  }

  const layers = labelmap.labelmaps;
  if (!layers) {
    return [];
  }

  // Prefer primary / first layer; for overlapping SEGs take the first group's images.
  const first = Object.values(layers)[0];
  return first?.imageIds ?? [];
}

function labelmapFromStackImages(
  segmentation: NonNullable<ReturnType<SegmentationServiceLike['getSegmentation']>>
): LabelmapBundle | null {
  const imageIds = collectStackLabelmapImageIds(segmentation);
  if (!imageIds.length) {
    return null;
  }

  const images = imageIds
    .map(id => cache.getImage(id))
    .filter((image): image is NonNullable<typeof image> => Boolean(image));

  if (!images.length) {
    return null;
  }

  const cols = Number(images[0].columns ?? images[0].width);
  const rows = Number(images[0].rows ?? images[0].height);
  if (!cols || !rows) {
    return null;
  }

  const dims: [number, number, number] = [cols, rows, images.length];
  const expected = cols * rows * images.length;
  const lab = new Uint8Array(expected);
  const sliceLen = cols * rows;

  for (let z = 0; z < images.length; z++) {
    const scalars =
      images[z].voxelManager?.getScalarData?.() ??
      (images[z] as { getPixelData?: () => ArrayLike<number> }).getPixelData?.();
    if (!scalars) {
      continue;
    }
    const slice = toUint8Labelmap(scalars, sliceLen);
    lab.set(slice, z * sliceLen);
  }

  // Geometry: prefer a cached volume that matches this stack's XY×Z grid.
  const referencedImageIds =
    segmentation.representationData?.Labelmap?.referencedImageIds ??
    images
      .map(image => (image as { referencedImageId?: string }).referencedImageId)
      .filter((id): id is string => Boolean(id));

  const sourceIds =
    referencedImageIds.length === images.length
      ? referencedImageIds
      : images.map(
          (image, i) =>
            (image as { referencedImageId?: string }).referencedImageId ??
            referencedImageIds[i]
        );

  const volume = findMatchingVolume(dims, referencedImageIds);

  if (
    volume?.dimensions &&
    volume.dimensions[0] === cols &&
    volume.dimensions[1] === rows &&
    volume.dimensions[2] === images.length &&
    volume.spacing
  ) {
    const aligned = alignLabelmapWithVolume(lab, dims, sourceIds, volume);
    return {
      lab: aligned.lab,
      dimensions: dims,
      ijkToWorld: buildIjkToWorld(
        (volume.origin ?? [0, 0, 0]) as [number, number, number],
        volume.spacing as [number, number, number],
        volume.direction
      ),
    };
  }

  // Fallback: imagePlaneModule of first/last slices.
  const firstId = referencedImageIds[0] ?? imageIds[0];
  const lastId =
    referencedImageIds[referencedImageIds.length - 1] ??
    imageIds[imageIds.length - 1];
  const firstPlane = metaData.get('imagePlaneModule', firstId) as
    | {
        imagePositionPatient?: number[];
        rowCosines?: number[];
        columnCosines?: number[];
        rowPixelSpacing?: number;
        columnPixelSpacing?: number;
        sliceThickness?: number;
      }
    | undefined;
  const lastPlane = metaData.get('imagePlaneModule', lastId) as
    | { imagePositionPatient?: number[] }
    | undefined;

  if (!firstPlane?.imagePositionPatient) {
    console.warn(
      '[slicerLiveSegBridge] Could not resolve stack labelmap geometry'
    );
    return { lab, dimensions: dims, ijkToWorld: buildIjkToWorld([0, 0, 0], [1, 1, 1]) };
  }

  const origin = firstPlane.imagePositionPatient as [number, number, number];
  const row = firstPlane.rowCosines ?? [1, 0, 0];
  const col = firstPlane.columnCosines ?? [0, 1, 0];
  const sx = firstPlane.columnPixelSpacing ?? 1;
  const sy = firstPlane.rowPixelSpacing ?? 1;

  let sz = firstPlane.sliceThickness ?? 1;
  let kDir = [
    row[1] * col[2] - row[2] * col[1],
    row[2] * col[0] - row[0] * col[2],
    row[0] * col[1] - row[1] * col[0],
  ];
  if (lastPlane?.imagePositionPatient && images.length > 1) {
    const dx = lastPlane.imagePositionPatient[0] - origin[0];
    const dy = lastPlane.imagePositionPatient[1] - origin[1];
    const dz = lastPlane.imagePositionPatient[2] - origin[2];
    const span = Math.hypot(dx, dy, dz);
    if (span > 1e-6) {
      sz = span / (images.length - 1);
      kDir = [dx / span, dy / span, dz / span];
    }
  }

  const direction = [
    row[0],
    row[1],
    row[2],
    col[0],
    col[1],
    col[2],
    kDir[0],
    kDir[1],
    kDir[2],
  ];

  return {
    lab,
    dimensions: dims,
    ijkToWorld: buildIjkToWorld(origin, [sx, sy, sz], direction),
  };
}

function segmentIsVisibleOnViewport(
  segmentationService: SegmentationServiceLike,
  viewportId: string,
  segmentationId: string,
  segmentIndex: number
): boolean {
  const reps = segmentationService.getSegmentationRepresentations?.(viewportId, {
    segmentationId,
  });
  if (!reps?.length) {
    return true;
  }
  const rep =
    reps.find(r => r.type === 'Labelmap') ?? reps[0];
  if (rep.visible === false) {
    return false;
  }
  const segment =
    rep.segments?.[segmentIndex] ?? rep.segments?.[String(segmentIndex)];
  return segment?.visible !== false;
}

/**
 * Push CS3D per-segment colour + visibility onto a mounted SlicerLive overlay.
 * No-op when SlicerLive is not mounted or has no SDF yet.
 */
export function syncSlicerLiveSegmentAppearance(
  viewportId: string,
  segmentationId: string,
  segmentationService: SegmentationServiceLike
): boolean {
  if (!getSlicerLiveVolume3D(viewportId)) {
    return false;
  }

  const segmentation = segmentationService.getSegmentation(segmentationId);
  const segments = segmentation?.segments ?? {};
  const appearances: Array<{
    num: number;
    color: [number, number, number];
    opacity: number;
  }> = [];

  for (const key of Object.keys(segments)) {
    const segment = segments[key];
    const segmentIndex = Number(segment?.segmentIndex ?? key);
    if (!Number.isFinite(segmentIndex) || segmentIndex < 1) {
      continue;
    }
    const rgba = segmentationService.getSegmentColor(
      viewportId,
      segmentationId,
      segmentIndex
    );
    const rgb = rgbaToUnitRgb(rgba) ?? defaultSegmentColor(segmentIndex);
    const visible = segmentIsVisibleOnViewport(
      segmentationService,
      viewportId,
      segmentationId,
      segmentIndex
    );
    appearances.push({
      num: segmentIndex,
      color: rgb,
      opacity: visible ? 1 : 0,
    });
  }

  if (appearances.length === 0) {
    return false;
  }
  return setSlicerLiveVolume3DSegmentAppearance(viewportId, appearances);
}

/**
 * Push a hydrated OHIF SEG labelmap into the SlicerLive SDF SegmentField for
 * a volume3d slicerLive viewport. No-op when SlicerLive is not mounted.
 */
export async function applySlicerLiveSegmentationFromOHIF(
  viewportId: string,
  segmentationId: string,
  segmentationService: SegmentationServiceLike
): Promise<boolean> {
  if (!getSlicerLiveVolume3D(viewportId)) {
    return false;
  }

  const segmentation = segmentationService.getSegmentation(segmentationId);
  const fromVolume = segmentationService.getLabelmapVolume(segmentationId);
  const bundle =
    (segmentation ? labelmapFromStackImages(segmentation) : null) ??
    (fromVolume ? labelmapFromVolume(fromVolume) : null);

  if (!bundle) {
    console.warn(
      `[slicerLiveSegBridge] No labelmap volume/stack for segmentation "${segmentationId}"`
    );
    return false;
  }

  const colors: Array<[number, number, number, number]> = [];
  const names: Record<number, string> = {};
  const segments = segmentation?.segments ?? {};

  for (const key of Object.keys(segments)) {
    const segment = segments[key];
    const segmentIndex = Number(segment?.segmentIndex ?? key);
    if (!Number.isFinite(segmentIndex) || segmentIndex < 1) {
      continue;
    }
    const rgba = segmentationService.getSegmentColor(
      viewportId,
      segmentationId,
      segmentIndex
    );
    const rgb = rgbaToUnitRgb(rgba) ?? defaultSegmentColor(segmentIndex);
    colors.push([segmentIndex, rgb[0], rgb[1], rgb[2]]);
    if (segment?.label) {
      names[segmentIndex] = segment.label;
    }
  }

  if (colors.length === 0) {
    console.warn(
      `[slicerLiveSegBridge] No segment colours for segmentation "${segmentationId}"`
    );
    return false;
  }

  const applied = await setSlicerLiveVolume3DSegmentation(viewportId, {
    lab: bundle.lab,
    dimensions: bundle.dimensions,
    ijkToWorld: bundle.ijkToWorld,
    colors,
    names,
  });
  if (applied) {
    syncSlicerLiveSegmentAppearance(viewportId, segmentationId, segmentationService);
  }
  return applied;
}

/** Clear SlicerLive segmentation for a viewport (no-op if not mounted). */
export async function clearSlicerLiveSegmentationForViewport(
  viewportId: string
): Promise<boolean> {
  progressiveSessions.delete(viewportId);
  if (!getSlicerLiveVolume3D(viewportId)) {
    return false;
  }
  return clearSlicerLiveVolume3DSegmentation(viewportId);
}

type ProgressiveSession = {
  begun: boolean;
  uploadedSlices: Uint8Array;
  dimensions: [number, number, number];
};

const progressiveSessions = new Map<string, ProgressiveSession>();

type LabelmapImageLike = {
  columns?: number;
  width?: number;
  rows?: number;
  height?: number;
  voxelManager?: { getScalarData?: () => ArrayLike<number> };
  getPixelData?: () => ArrayLike<number>;
  referencedImageId?: string;
  imageId?: string;
};

type ProgressiveSegDisplaySet = {
  displaySetInstanceUID?: string;
  labelMapImages?: LabelmapImageLike[][];
  referencedImageIds?: string[];
  progressiveSegMetadata?: {
    data?: Array<{
      SegmentNumber?: number;
      SegmentLabel?: string;
      rgba?: number[];
      RecommendedDisplayCIELabValue?: number[];
    }>;
  };
  segments?: Record<
    string,
    { segmentIndex?: number; label?: string; color?: number[] }
  >;
};

/**
 * Pack whatever SEG labelmap slices are already filled (primary group).
 * Missing slices stay zero; loadedSliceIndices lists z with any non-zero voxels
 * or a non-empty scalar buffer.
 */
export function materializeSegLabelmapProgressive(
  displaySet: ProgressiveSegDisplaySet
):
  | {
      lab: Uint8Array;
      dimensions: [number, number, number];
      ijkToWorld: number[];
      loadedSliceIndices: number[];
    }
  | undefined {
  const group = displaySet.labelMapImages?.[0];
  if (!group?.length) {
    return undefined;
  }

  const cols = Number(group[0].columns ?? group[0].width);
  const rows = Number(group[0].rows ?? group[0].height);
  if (!cols || !rows) {
    return undefined;
  }

  const depth = group.length;
  const sliceLen = cols * rows;
  const lab = new Uint8Array(sliceLen * depth);
  const rawLoadedSliceIndices: number[] = [];

  for (let z = 0; z < depth; z++) {
    const image = group[z];
    const scalars =
      image?.voxelManager?.getScalarData?.() ?? image?.getPixelData?.();
    if (!scalars || scalars.length === 0) {
      continue;
    }
    let any = false;
    const off = z * sliceLen;
    const n = Math.min(sliceLen, scalars.length);
    for (let i = 0; i < n; i++) {
      const v = Number(scalars[i]);
      if (!Number.isFinite(v) || v <= 0) {
        continue;
      }
      lab[off + i] = Math.max(0, Math.min(255, Math.round(v)));
      any = true;
    }
    if (any) {
      rawLoadedSliceIndices.push(z);
    }
  }

  if (rawLoadedSliceIndices.length === 0 && !group.some(img => img)) {
    return undefined;
  }

  const referencedImageIds =
    displaySet.referencedImageIds ??
    group
      .map(img => img.referencedImageId)
      .filter((id): id is string => Boolean(id));

  const sourceIds = group.map(
    (img, i) => img?.referencedImageId ?? referencedImageIds[i]
  );

  const dims: [number, number, number] = [cols, rows, depth];
  const volume = findMatchingVolume(dims, referencedImageIds);
  const aligned = alignLabelmapWithVolume(lab, dims, sourceIds, volume);
  const loadedSliceIndices = aligned.sliceIndexMap
    ? remapLoadedSliceIndices(rawLoadedSliceIndices, aligned.sliceIndexMap)
    : rawLoadedSliceIndices;
  const ijkToWorld = resolveGeometryIjkToWorld(dims, referencedImageIds, group, volume);

  return {
    lab: aligned.lab,
    dimensions: dims,
    ijkToWorld,
    loadedSliceIndices,
  };
}

function resolveGeometryIjkToWorld(
  dims: [number, number, number],
  referencedImageIds: string[],
  group: LabelmapImageLike[],
  volume?: CachedVolumeLike
): number[] {
  const matched = volume ?? findMatchingVolume(dims, referencedImageIds);
  if (matched?.spacing) {
    return buildIjkToWorld(
      (matched.origin ?? [0, 0, 0]) as [number, number, number],
      matched.spacing as [number, number, number],
      matched.direction
    );
  }

  const firstId = referencedImageIds[0] ?? group[0]?.referencedImageId;
  const lastId =
    referencedImageIds[referencedImageIds.length - 1] ??
    group[group.length - 1]?.referencedImageId;
  if (!firstId) {
    return buildIjkToWorld([0, 0, 0], [1, 1, 1]);
  }

  const firstPlane = metaData.get('imagePlaneModule', firstId) as
    | {
        imagePositionPatient?: number[];
        rowCosines?: number[];
        columnCosines?: number[];
        rowPixelSpacing?: number;
        columnPixelSpacing?: number;
        sliceThickness?: number;
      }
    | undefined;
  const lastPlane = lastId
    ? (metaData.get('imagePlaneModule', lastId) as
        | { imagePositionPatient?: number[] }
        | undefined)
    : undefined;

  if (!firstPlane?.imagePositionPatient) {
    return buildIjkToWorld([0, 0, 0], [1, 1, 1]);
  }

  const origin = firstPlane.imagePositionPatient as [number, number, number];
  const row = firstPlane.rowCosines ?? [1, 0, 0];
  const col = firstPlane.columnCosines ?? [0, 1, 0];
  const sx = firstPlane.columnPixelSpacing ?? 1;
  const sy = firstPlane.rowPixelSpacing ?? 1;
  let sz = firstPlane.sliceThickness ?? 1;
  let kDir = [
    row[1] * col[2] - row[2] * col[1],
    row[2] * col[0] - row[0] * col[2],
    row[0] * col[1] - row[1] * col[0],
  ];
  if (lastPlane?.imagePositionPatient && dims[2] > 1) {
    const dx = lastPlane.imagePositionPatient[0] - origin[0];
    const dy = lastPlane.imagePositionPatient[1] - origin[1];
    const dz = lastPlane.imagePositionPatient[2] - origin[2];
    const span = Math.hypot(dx, dy, dz);
    if (span > 1e-6) {
      sz = span / (dims[2] - 1);
      kDir = [dx / span, dy / span, dz / span];
    }
  }
  return buildIjkToWorld(
    origin,
    [sx, sy, sz],
    [
      row[0],
      row[1],
      row[2],
      col[0],
      col[1],
      col[2],
      kDir[0],
      kDir[1],
      kDir[2],
    ]
  );
}

function colorsFromProgressiveDisplaySet(
  displaySet: ProgressiveSegDisplaySet,
  viewportId: string,
  segmentationId: string,
  segmentationService?: SegmentationServiceLike
): {
  colors: Array<[number, number, number, number]>;
  names: Record<number, string>;
} {
  const colors: Array<[number, number, number, number]> = [];
  const names: Record<number, string> = {};

  const metaDataList = displaySet.progressiveSegMetadata?.data;
  if (metaDataList?.length) {
    for (let i = 1; i < metaDataList.length; i++) {
      const entry = metaDataList[i];
      const segmentIndex = Number(entry?.SegmentNumber ?? i);
      if (!Number.isFinite(segmentIndex) || segmentIndex < 1) {
        continue;
      }
      const rgb =
        rgbaToUnitRgb(entry.rgba) ?? defaultSegmentColor(segmentIndex);
      colors.push([segmentIndex, rgb[0], rgb[1], rgb[2]]);
      if (entry.SegmentLabel) {
        names[segmentIndex] = entry.SegmentLabel;
      }
    }
  }

  if (colors.length === 0 && displaySet.segments) {
    for (const key of Object.keys(displaySet.segments)) {
      const segment = displaySet.segments[key];
      const segmentIndex = Number(segment?.segmentIndex ?? key);
      if (!Number.isFinite(segmentIndex) || segmentIndex < 1) {
        continue;
      }
      const rgb =
        rgbaToUnitRgb(segment.color) ?? defaultSegmentColor(segmentIndex);
      colors.push([segmentIndex, rgb[0], rgb[1], rgb[2]]);
      if (segment.label) {
        names[segmentIndex] = segment.label;
      }
    }
  }

  if (colors.length === 0 && segmentationService) {
    const segmentation = segmentationService.getSegmentation(segmentationId);
    const segments = segmentation?.segments ?? {};
    for (const key of Object.keys(segments)) {
      const segment = segments[key];
      const segmentIndex = Number(segment?.segmentIndex ?? key);
      if (!Number.isFinite(segmentIndex) || segmentIndex < 1) {
        continue;
      }
      const rgba = segmentationService.getSegmentColor(
        viewportId,
        segmentationId,
        segmentIndex
      );
      const rgb = rgbaToUnitRgb(rgba) ?? defaultSegmentColor(segmentIndex);
      colors.push([segmentIndex, rgb[0], rgb[1], rgb[2]]);
      if (segment?.label) {
        names[segmentIndex] = segment.label;
      }
    }
  }

  return { colors, names };
}

/**
 * Progressive SlicerLive SEG apply from a partially-filled displaySet.labelMapImages.
 * Call on load progress; call finalizeSlicerLiveSegmentationProgressive when load completes.
 */
export async function applySlicerLiveSegmentationProgressive(params: {
  viewportId: string;
  displaySet: ProgressiveSegDisplaySet;
  segmentationId: string;
  segmentationService?: SegmentationServiceLike;
}): Promise<boolean> {
  const { viewportId, displaySet, segmentationId, segmentationService } = params;
  if (!getSlicerLiveVolume3D(viewportId)) {
    return false;
  }

  const progressive = materializeSegLabelmapProgressive(displaySet);
  if (!progressive) {
    return false;
  }

  let session = progressiveSessions.get(viewportId);
  if (!session?.begun) {
    const { colors, names } = colorsFromProgressiveDisplaySet(
      displaySet,
      viewportId,
      segmentationId,
      segmentationService
    );
    if (colors.length === 0) {
      return false;
    }
    const begun = await beginSlicerLiveVolume3DSegmentation(viewportId, {
      dimensions: progressive.dimensions,
      ijkToWorld: progressive.ijkToWorld,
      colors,
      names,
    });
    if (!begun) {
      return false;
    }
    if (segmentationService) {
      syncSlicerLiveSegmentAppearance(
        viewportId,
        segmentationId,
        segmentationService
      );
    }
    session = {
      begun: true,
      uploadedSlices: new Uint8Array(progressive.dimensions[2]),
      dimensions: progressive.dimensions,
    };
    progressiveSessions.set(viewportId, session);
  }

  const newIndices: number[] = [];
  for (const z of progressive.loadedSliceIndices) {
    if (!session.uploadedSlices[z]) {
      newIndices.push(z);
    }
  }
  if (newIndices.length === 0) {
    return true;
  }

  const updated = await updateSlicerLiveVolume3DSegmentationSlices(viewportId, {
    lab: progressive.lab,
    dimensions: progressive.dimensions,
    sliceIndices: newIndices,
  });
  if (updated) {
    for (const z of newIndices) {
      session.uploadedSlices[z] = 1;
    }
  }
  return updated;
}

/** Settle SDF after progressive SEG streaming completes. */
export async function finalizeSlicerLiveSegmentationProgressive(
  viewportId: string
): Promise<boolean> {
  const session = progressiveSessions.get(viewportId);
  if (!session?.begun) {
    return false;
  }
  const ok = await finalizeSlicerLiveVolume3DSegmentation(viewportId);
  progressiveSessions.delete(viewportId);
  return ok;
}
