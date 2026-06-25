export type Point3D = [number, number, number];

export type CoordinateSpace = 'LPS' | 'RAS';

export type RatedLine = {
  rater: string;
  line: {
    points: Point3D[];
  };
};

export type FrameAnnotation = {
  frame_number: number;
  coordinate_space: CoordinateSpace;
  pleura_lines: RatedLine[];
  b_lines: RatedLine[];
};

export type USAnnotationRatingFile = {
  frame_annotations: FrameAnnotation[];
  SOPInstanceUID?: string;
  GrayscaleConversion?: boolean;
  mask_type?: string;
  angle1?: number;
  angle2?: number;
  center_rows_px?: number;
  center_cols_px?: number;
  radius1?: number;
  radius2?: number;
  image_size_rows?: number;
  image_size_cols?: number;
  AnnotationLabels?: string[];
  labels?: string[];
};

export type PanelRow = {
  frame: number;
  pleura: number;
  bLine: number;
  index: number;
  imageId?: string;
  source: 'imported' | 'live';
  raters?: string[];
};

export function normalizeRaterName(rater: string): string {
  return rater.trim().toLowerCase();
}

export function raterMatches(lineRater: string, filterRater?: string): boolean {
  if (!filterRater) {
    return true;
  }
  return normalizeRaterName(lineRater) === normalizeRaterName(filterRater);
}

function isRatedLine(value: unknown): value is RatedLine {
  return (
    typeof value === 'object' &&
    value !== null &&
    'line' in value &&
    typeof (value as RatedLine).line === 'object' &&
    Array.isArray((value as RatedLine).line?.points)
  );
}

function normalizeLine(value: unknown): RatedLine {
  if (!isRatedLine(value)) {
    throw new Error('Invalid line entry: expected { rater, line: { points } }');
  }

  return {
    rater: normalizeRaterName(value.rater ?? ''),
    line: { points: value.line.points as Point3D[] },
  };
}

function normalizeCoordinateSpace(value: unknown): CoordinateSpace {
  return value === 'RAS' ? 'RAS' : 'LPS';
}

function cloneFrame(frame: FrameAnnotation): FrameAnnotation {
  return {
    ...frame,
    pleura_lines: frame.pleura_lines.map(line => ({
      rater: line.rater,
      line: { points: line.line.points.map(p => [...p] as Point3D) },
    })),
    b_lines: frame.b_lines.map(line => ({
      rater: line.rater,
      line: { points: line.line.points.map(p => [...p] as Point3D) },
    })),
  };
}

export function extractRatersFromFrames(frameAnnotations: FrameAnnotation[]): string[] {
  const raters = new Set<string>();
  frameAnnotations.forEach(frame => {
    [...frame.pleura_lines, ...frame.b_lines].forEach(line => {
      if (line.rater) {
        raters.add(line.rater);
      }
    });
  });
  return Array.from(raters).sort();
}

/**
 * Merges imported frames into existing data. Lines from raters present in the
 * import file replace that rater's lines; other raters are preserved.
 */
export function mergeImportedFrames(
  existing: FrameAnnotation[],
  imported: FrameAnnotation[]
): FrameAnnotation[] {
  const importedRaters = new Set(extractRatersFromFrames(imported));
  const byFrame = new Map<number, FrameAnnotation>();

  existing.forEach(frame => {
    byFrame.set(frame.frame_number, cloneFrame(frame));
  });

  imported.forEach(importedFrame => {
    let frame = byFrame.get(importedFrame.frame_number);
    if (!frame) {
      frame = {
        frame_number: importedFrame.frame_number,
        coordinate_space: importedFrame.coordinate_space,
        pleura_lines: [],
        b_lines: [],
      };
      byFrame.set(importedFrame.frame_number, frame);
    }

    frame.pleura_lines = frame.pleura_lines.filter(
      line => !importedRaters.has(line.rater)
    );
    frame.b_lines = frame.b_lines.filter(line => !importedRaters.has(line.rater));

    frame.pleura_lines.push(
      ...importedFrame.pleura_lines.map(line => ({
        rater: line.rater,
        line: { points: line.line.points.map(p => [...p] as Point3D) },
      }))
    );
    frame.b_lines.push(
      ...importedFrame.b_lines.map(line => ({
        rater: line.rater,
        line: { points: line.line.points.map(p => [...p] as Point3D) },
      }))
    );
  });

  return Array.from(byFrame.values()).sort((a, b) => a.frame_number - b.frame_number);
}

export function filterFramesByRater(
  frameAnnotations: FrameAnnotation[],
  rater: string
): FrameAnnotation[] {
  if (!rater) {
    return [];
  }

  return frameAnnotations
    .map(frame => ({
      ...frame,
      pleura_lines: frame.pleura_lines.filter(line => raterMatches(line.rater, rater)),
      b_lines: frame.b_lines.filter(line => raterMatches(line.rater, rater)),
    }))
    .filter(frame => frame.pleura_lines.length > 0 || frame.b_lines.length > 0);
}

/**
 * Parses Slicer AnnotateUltrasound JSON (array-based frame_annotations).
 */
export function parseUSAnnotationJson(raw: unknown): USAnnotationRatingFile {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid annotation JSON: expected an object');
  }

  const data = raw as Record<string, unknown>;
  const frameAnnotationsRaw = data.frame_annotations;

  if (!Array.isArray(frameAnnotationsRaw)) {
    throw new Error('Invalid annotation JSON: frame_annotations must be an array');
  }

  const frame_annotations: FrameAnnotation[] = frameAnnotationsRaw.map((entry, index) => {
    const frame = entry as {
      frame_number?: number;
      coordinate_space?: string;
      pleura_lines?: unknown[];
      b_lines?: unknown[];
    };
    const frameNumber = typeof frame.frame_number === 'number' ? frame.frame_number : index;

    return {
      frame_number: frameNumber,
      coordinate_space: normalizeCoordinateSpace(frame.coordinate_space),
      pleura_lines: (frame.pleura_lines ?? []).map(line => normalizeLine(line)),
      b_lines: (frame.b_lines ?? []).map(line => normalizeLine(line)),
    };
  });

  return {
    frame_annotations,
    SOPInstanceUID: data.SOPInstanceUID as string | undefined,
    GrayscaleConversion: data.GrayscaleConversion as boolean | undefined,
    mask_type: data.mask_type as string | undefined,
    angle1: data.angle1 as number | undefined,
    angle2: data.angle2 as number | undefined,
    center_rows_px: data.center_rows_px as number | undefined,
    center_cols_px: data.center_cols_px as number | undefined,
    radius1: data.radius1 as number | undefined,
    radius2: data.radius2 as number | undefined,
    image_size_rows: data.image_size_rows as number | undefined,
    image_size_cols: data.image_size_cols as number | undefined,
    AnnotationLabels: (data.AnnotationLabels as string[] | undefined) ?? [],
    labels: (data.labels as string[] | undefined) ?? [],
  };
}

/**
 * Maps normalized frame annotations to panel table rows.
 */
export function toPanelRows(
  frameAnnotations: FrameAnnotation[],
  source: 'imported' | 'live' = 'imported',
  rater?: string
): PanelRow[] {
  const rows: PanelRow[] = [];

  frameAnnotations
    .slice()
    .sort((a, b) => a.frame_number - b.frame_number)
    .forEach(frame => {
      const pleuraLines = rater
        ? frame.pleura_lines.filter(line => raterMatches(line.rater, rater))
        : frame.pleura_lines;
      const bLines = rater
        ? frame.b_lines.filter(line => raterMatches(line.rater, rater))
        : frame.b_lines;

      if (rater && pleuraLines.length === 0 && bLines.length === 0) {
        return;
      }

      const raters = [
        ...new Set(
          [...frame.pleura_lines, ...frame.b_lines]
            .map(line => line.rater)
            .filter(Boolean)
        ),
      ];

      rows.push({
        frame: frame.frame_number,
        pleura: pleuraLines.length,
        bLine: bLines.length,
        index: rows.length + 1,
        source,
        raters: raters.length > 0 ? raters : undefined,
      });
    });

  return rows;
}

export type SerializeMetadata = {
  SOPInstanceUID?: string;
  GrayscaleConversion?: boolean;
  mask_type?: string;
  angle1?: number;
  angle2?: number;
  center_rows_px?: number;
  center_cols_px?: number;
  radius1?: number;
  radius2?: number;
  image_size_rows?: number;
  image_size_cols?: number;
};

/**
 * Serializes per-frame annotation data into the Slicer rating file format.
 * Line points are LPS world coordinates (mm).
 */
export function serializeUSAnnotationJson(
  frameData: Map<number, { pleura_lines: Point3D[][]; b_lines: Point3D[][] }>,
  metadata: SerializeMetadata,
  options: { labels?: string[]; rater?: string } = {}
): USAnnotationRatingFile {
  const { labels = [], rater = '' } = options;
  const normalizedRater = normalizeRaterName(rater);

  const frame_annotations = Array.from(frameData.entries())
    .sort(([a], [b]) => a - b)
    .map(([frame_number, lines]) => ({
      frame_number,
      coordinate_space: 'LPS' as const,
      pleura_lines: lines.pleura_lines.map(points => ({
        rater: normalizedRater,
        line: { points },
      })),
      b_lines: lines.b_lines.map(points => ({
        rater: normalizedRater,
        line: { points },
      })),
    }))
    .filter(frame => frame.pleura_lines.length > 0 || frame.b_lines.length > 0);

  return {
    frame_annotations,
    ...metadata,
    AnnotationLabels: labels,
    labels: [],
  };
}

export function serializeFrameAnnotations(
  frameAnnotations: FrameAnnotation[],
  metadata: SerializeMetadata,
  options: { labels?: string[]; rater?: string } = {}
): USAnnotationRatingFile {
  const { labels = [], rater = '' } = options;
  const normalizedRater = normalizeRaterName(rater);

  const frame_annotations = frameAnnotations
    .map(frame => ({
      frame_number: frame.frame_number,
      coordinate_space: 'LPS' as const,
      pleura_lines: frame.pleura_lines.map(line => ({
        rater: normalizedRater || line.rater,
        line: { points: line.line.points },
      })),
      b_lines: frame.b_lines.map(line => ({
        rater: normalizedRater || line.rater,
        line: { points: line.line.points },
      })),
    }))
    .filter(frame => frame.pleura_lines.length > 0 || frame.b_lines.length > 0);

  return {
    frame_annotations,
    ...metadata,
    AnnotationLabels: labels,
    labels: [],
  };
}

/**
 * Returns non-blocking warnings when imported JSON may not match the active viewport.
 */
export function validateForViewport(
  json: USAnnotationRatingFile,
  viewportSopInstanceUid?: string
): string[] {
  const warnings: string[] = [];

  if (
    json.SOPInstanceUID &&
    viewportSopInstanceUid &&
    json.SOPInstanceUID !== viewportSopInstanceUid
  ) {
    warnings.push(
      `SOPInstanceUID mismatch: file has ${json.SOPInstanceUID}, viewport has ${viewportSopInstanceUid}`
    );
  }

  return warnings;
}

export function mergePanelRows(imported: PanelRow[], live: PanelRow[]): PanelRow[] {
  const byFrame = new Map<number, PanelRow>();

  imported.forEach(row => {
    byFrame.set(row.frame, row);
  });

  live.forEach(row => {
    byFrame.set(row.frame, { ...row, source: 'live' });
  });

  return Array.from(byFrame.values())
    .sort((a, b) => a.frame - b.frame)
    .map((row, index) => ({ ...row, index: index + 1 }));
}