import {
  beginSlicerLiveVolume3DSegmentation,
  cache,
  clearSlicerLiveVolume3DSegmentation,
  finalizeSlicerLiveVolume3DSegmentation,
  getSlicerLiveVolume3D,
  metaData,
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

  const volumes = cache.getVolumes?.() ?? [];
  const volume = volumes.find(v => {
    if (!v?.dimensions || !v?.spacing) {
      return false;
    }
    const sameGrid =
      v.dimensions[0] === cols &&
      v.dimensions[1] === rows &&
      v.dimensions[2] === images.length;
    if (sameGrid) {
      return true;
    }
    return Boolean(
      referencedImageIds[0] && v.imageIds?.includes?.(referencedImageIds[0])
    );
  });

  if (
    volume?.dimensions &&
    volume.dimensions[0] === cols &&
    volume.dimensions[1] === rows &&
    volume.dimensions[2] === images.length &&
    volume.spacing
  ) {
    return {
      lab,
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
    (fromVolume ? labelmapFromVolume(fromVolume) : null) ??
    (segmentation ? labelmapFromStackImages(segmentation) : null);

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

  return setSlicerLiveVolume3DSegmentation(viewportId, {
    lab: bundle.lab,
    dimensions: bundle.dimensions,
    ijkToWorld: bundle.ijkToWorld,
    colors,
    names,
  });
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
  const loadedSliceIndices: number[] = [];

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
      loadedSliceIndices.push(z);
    }
  }

  if (loadedSliceIndices.length === 0 && !group.some(img => img)) {
    return undefined;
  }

  const referencedImageIds =
    displaySet.referencedImageIds ??
    group
      .map(img => img.referencedImageId)
      .filter((id): id is string => Boolean(id));

  const dims: [number, number, number] = [cols, rows, depth];
  const ijkToWorld = resolveGeometryIjkToWorld(dims, referencedImageIds, group);

  return { lab, dimensions: dims, ijkToWorld, loadedSliceIndices };
}

function resolveGeometryIjkToWorld(
  dims: [number, number, number],
  referencedImageIds: string[],
  group: LabelmapImageLike[]
): number[] {
  const volumes = cache.getVolumes?.() ?? [];
  const volume = volumes.find(v => {
    if (!v?.dimensions || !v?.spacing) {
      return false;
    }
    return (
      v.dimensions[0] === dims[0] &&
      v.dimensions[1] === dims[1] &&
      v.dimensions[2] === dims[2]
    );
  });
  if (volume?.spacing) {
    return buildIjkToWorld(
      (volume.origin ?? [0, 0, 0]) as [number, number, number],
      volume.spacing as [number, number, number],
      volume.direction
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
