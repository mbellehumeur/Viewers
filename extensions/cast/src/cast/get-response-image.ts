import {
  GetRequestDataType,
  SUPPORTED_GET_REQUEST_TYPES,
} from './types';

type CapturedImage = { contentType: 'image/png' | 'image/jpeg'; data: string };

export const CAST_VIEW_THUMBNAIL_MAX_WIDTH = 160;

export function extractBase64FromDataUrl(dataUrl: string): string {
  const marker = 'base64,';
  const idx = dataUrl.indexOf(marker);
  return idx >= 0 ? dataUrl.slice(idx + marker.length) : '';
}

export function captureCanvasThumbnailBase64(
  sourceCanvas: HTMLCanvasElement,
  maxWidth = CAST_VIEW_THUMBNAIL_MAX_WIDTH,
  mimeType: 'image/png' | 'image/jpeg' = 'image/png',
  quality?: number
): {
  contentType: 'image/png' | 'image/jpeg';
  data: string;
  width: number;
  height: number;
} | null {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  if (width <= 0 || height <= 0) {
    return null;
  }
  const scale = Math.min(1, maxWidth / width);
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const tmp = document.createElement('canvas');
  tmp.width = outWidth;
  tmp.height = outHeight;
  const ctx = tmp.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.drawImage(sourceCanvas, 0, 0, outWidth, outHeight);
  try {
    const dataUrl =
      mimeType === 'image/jpeg'
        ? tmp.toDataURL(mimeType, quality)
        : tmp.toDataURL(mimeType);
    const data = extractBase64FromDataUrl(dataUrl);
    return data
      ? { contentType: mimeType, data, width: outWidth, height: outHeight }
      : null;
  } catch {
    return null;
  }
}

export function getCanvasForViewportId(viewportId: string): HTMLCanvasElement | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const root =
    document.querySelector(`[data-viewport-uid="${CSS.escape(viewportId)}"]`) ||
    document.querySelector(`[data-viewport-id="${CSS.escape(viewportId)}"]`) ||
    document.querySelector(`[data-viewportid="${CSS.escape(viewportId)}"]`);
  if (!root) {
    return null;
  }
  const canvases = Array.from(root.querySelectorAll<HTMLCanvasElement>('canvas')).filter(
    canvas => canvas.width > 0 && canvas.height > 0
  );
  if (!canvases.length) {
    return null;
  }
  return canvases.reduce((best, canvas) => {
    const bestArea = best.width * best.height;
    const area = canvas.width * canvas.height;
    return area > bestArea ? canvas : best;
  });
}

export function captureViewportThumbnailPng(viewportId: string) {
  const canvas = getCanvasForViewportId(viewportId);
  if (!canvas) {
    return null;
  }
  return captureCanvasThumbnailBase64(canvas);
}

export function getPreferredViewerCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const canvases = Array.from(
    document.querySelectorAll<HTMLCanvasElement>('canvas')
  ).filter(canvas => canvas.width > 0 && canvas.height > 0);
  if (!canvases.length) {
    return null;
  }
  return (
    canvases.find(c =>
      c.closest(
        '.viewport-element, .cornerstone-viewport-element, [data-viewport-id], [data-viewport-uid], [data-viewportid]'
      )
    ) ||
    canvases[0] ||
    null
  );
}

function captureViewerFullSizeBase64(
  mimeType: 'image/png' | 'image/jpeg',
  quality?: number
): string {
  const canvas = getPreferredViewerCanvas();
  if (!canvas) {
    return '';
  }
  try {
    const dataUrl =
      mimeType === 'image/jpeg'
        ? canvas.toDataURL(mimeType, quality)
        : canvas.toDataURL(mimeType);
    return extractBase64FromDataUrl(dataUrl);
  } catch {
    return '';
  }
}

function captureViewerThumbnailBase64(
  mimeType: 'image/png' | 'image/jpeg',
  maxWidth = CAST_VIEW_THUMBNAIL_MAX_WIDTH,
  quality?: number
): string {
  const sourceCanvas = getPreferredViewerCanvas();
  if (!sourceCanvas) {
    return '';
  }
  const captured = captureCanvasThumbnailBase64(
    sourceCanvas,
    maxWidth,
    mimeType,
    quality
  );
  return captured?.data ?? '';
}

export function normalizeGetRequestDataType(
  value: unknown
): GetRequestDataType | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toUpperCase() as GetRequestDataType;
  return SUPPORTED_GET_REQUEST_TYPES.includes(normalized) ? normalized : null;
}

export function buildGetRequestImagePayload(
  dataType: GetRequestDataType
): CapturedImage | null {
  if (dataType === 'PNGTHUMBNAIL') {
    const data = captureViewerThumbnailBase64('image/png');
    return data ? { contentType: 'image/png', data } : null;
  }
  if (dataType === 'JPGTHUMBNAIL') {
    const data = captureViewerThumbnailBase64('image/jpeg', 160, 0.85);
    return data ? { contentType: 'image/jpeg', data } : null;
  }
  if (dataType === 'JPGFULLSIZE') {
    const data = captureViewerFullSizeBase64('image/jpeg', 0.92);
    return data ? { contentType: 'image/jpeg', data } : null;
  }
  const data = captureViewerFullSizeBase64('image/png');
  return data ? { contentType: 'image/png', data } : null;
}
