import {
  cache,
  clearSlicerLiveVolume3DSegmentation,
  getSlicerLiveVolume3D,
  metaData,
  setSlicerLiveVolume3DSegmentation,
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
  if (!getSlicerLiveVolume3D(viewportId)) {
    return false;
  }
  return clearSlicerLiveVolume3DSegmentation(viewportId);
}
