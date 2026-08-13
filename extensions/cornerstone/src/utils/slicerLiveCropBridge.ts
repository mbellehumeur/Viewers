import {
  getSlicerLiveVolume3D,
  getSlicerLiveVolume3DCropEnabled,
} from '@cornerstonejs/core';

type CropBridge = {
  detach: () => void;
};

const bridges = new Map<string, CropBridge>();

/**
 * Capture-phase handle drag on the SlicerLive canvas so TrackballRotate only
 * sees empty-space gestures (grab-or-bubble, matching SlicerLive roi-browser).
 */
export function attachSlicerLiveCropBridge(viewportId: string): boolean {
  detachSlicerLiveCropBridge(viewportId);

  const entry = getSlicerLiveVolume3D(viewportId);
  if (!entry || !entry.renderer.getCropEnabled()) {
    return false;
  }

  const { canvas, renderer } = entry;
  let hoveredId: number | null = null;

  const cssCursor = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      w: Math.max(1, r.width),
      h: Math.max(1, r.height),
    };
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    const { x, y, w, h } = cssCursor(e);
    const hit = renderer.pickCropHandle(x, y, w, h);
    if (!hit) {
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    if (!renderer.beginCropDrag(hit.id)) {
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = hit.cursor || 'grabbing';

    const onMove = (ev: PointerEvent) => {
      ev.stopPropagation();
      const p = cssCursor(ev);
      renderer.updateCropDrag(p.x, p.y, p.w, p.h);
    };
    const onUp = (ev: PointerEvent) => {
      ev.stopPropagation();
      renderer.endCropDrag();
      try {
        canvas.releasePointerCapture(ev.pointerId);
      } catch {
        // already released
      }
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      const hover = renderer.pickCropHandle(
        cssCursor(ev).x,
        cssCursor(ev).y,
        cssCursor(ev).w,
        cssCursor(ev).h
      );
      canvas.style.cursor = hover ? hover.cursor || 'grab' : '';
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
  };

  const onHover = (e: PointerEvent) => {
    if (!getSlicerLiveVolume3DCropEnabled(viewportId)) {
      return;
    }
    const { x, y, w, h } = cssCursor(e);
    const hit = renderer.pickCropHandle(x, y, w, h);
    const nextId = hit?.id ?? null;
    if (nextId !== hoveredId) {
      hoveredId = nextId;
      renderer.setCropHover(nextId);
      canvas.style.cursor = hit ? hit.cursor || 'grab' : '';
    }
  };

  canvas.addEventListener('pointerdown', onDown, true);
  canvas.addEventListener('pointermove', onHover);

  bridges.set(viewportId, {
    detach: () => {
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointermove', onHover);
      canvas.style.cursor = '';
      renderer.setCropHover(null);
      renderer.endCropDrag();
    },
  });
  return true;
}

export function detachSlicerLiveCropBridge(viewportId: string): void {
  const bridge = bridges.get(viewportId);
  if (!bridge) {
    return;
  }
  bridge.detach();
  bridges.delete(viewportId);
}
