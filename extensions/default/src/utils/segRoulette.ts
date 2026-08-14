/**
 * SegRoulette / "Segmentation rendering testing" helpers.
 * Manifest matches SlicerLive viewer/segroulette.json (collection-uniform spin).
 */

import {
  getSlicerLiveVolume3D,
  getSlicerLiveVolume3DVolumeOpacity,
  setSlicerLiveVolume3DVolumeOpacity,
} from '@cornerstonejs/core';

export type SegRouletteEntry = {
  /** Source image series CRDC UUID */
  c: string;
  /** SEG series CRDC UUID */
  s: string;
  /** Modality: CT / MR / PT */
  m: string;
  /** IDC collection id */
  col: string;
  /** StudyInstanceUID */
  st: string;
  /** Image SeriesInstanceUID */
  u: string;
  /** SEG SeriesInstanceUID */
  su: string;
  [key: string]: unknown;
};

export type SegRouletteManifest = {
  rows: SegRouletteEntry[];
  stats: Record<string, unknown> | null;
};

/** Collections present in the shipped spin pool (unique `col` values).
 * Keep in sync with extensions/cornerstone/src/utils/segRouletteCollections.ts.
 */
export const SEGROULETTE_COLLECTIONS = [
  'acrin_nsclc_fdg_pet',
  'adrenal_acc_ki67_seg',
  'anti_pd_1_lung',
  'c4kc_kits',
  'colorectal_liver_metastases',
  'cptac_ccrcc',
  'ct_lymph_nodes',
  'ct_phantom4radiomics',
  'duke_breast_cancer_mri',
  'eay131',
  'hcc_tace_seg',
  'lidc_idri',
  'lung_pet_ct_dx',
  'mediastinal_lymph_node_seg',
  'nlst',
  'nsclc_radiogenomics',
  'nsclc_radiomics',
  'nsclc_radiomics_interobserver1',
  'pancreas_ct',
  'prostate_mri_us_biopsy',
  'prostatex',
  'psma_pet_ct_lesions',
  'qin_breast',
  'qin_lung_ct',
  'qin_prostate_repeatability',
  'rider_lung_ct',
  'rider_lung_pet_ct',
  'spie_aapm_lung_ct_challenge',
  'spine_mets_ct_seg',
  'tcga_kich',
  'tcga_kirc',
  'tcga_kirp',
  'tcga_lihc',
  'tcga_luad',
  'tcga_lusc',
  'upenn_gbm',
] as const;

export const SEGROULETTE_SECTION_ID = 'SegRoulette';
export const SEGROULETTE_SPIN_BUTTON_ID = 'SegRouletteSpin';

export function collectionButtonId(collection: string): string {
  return `SegRoulette__${collection}`;
}

let cachedManifest: SegRouletteManifest | null = null;
let loadPromise: Promise<SegRouletteManifest> | null = null;

function publicBase(): string {
  const base = (typeof window !== 'undefined' && (window as any).PUBLIC_URL) || '/';
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

/** Load and cache segroulette.json (cache-busted). */
export async function loadManifest(
  url = `${publicBase()}/segroulette.json`
): Promise<SegRouletteManifest> {
  if (cachedManifest) {
    return cachedManifest;
  }
  if (loadPromise) {
    return loadPromise;
  }
  loadPromise = (async () => {
    const sep = url.includes('?') ? '&' : '?';
    const response = await fetch(`${url}${sep}t=${Date.now()}`);
    if (!response.ok) {
      throw new Error(`Failed to load SegRoulette manifest (${response.status})`);
    }
    const data = await response.json();
    const rows: SegRouletteEntry[] = Array.isArray(data) ? data : data.rows || [];
    cachedManifest = { rows, stats: data.stats || null };
    return cachedManifest;
  })().finally(() => {
    loadPromise = null;
  });
  return loadPromise;
}

/**
 * Pick a random series, collection-uniform (same as SlicerLive idc_tools).
 * Optional filter narrows rows (e.g. one collection).
 */
export function pickRandom(
  rows: SegRouletteEntry[],
  filter?: (entry: SegRouletteEntry) => boolean
): SegRouletteEntry {
  const byCol: Record<string, SegRouletteEntry[]> = {};
  for (const entry of rows) {
    if (filter && !filter(entry)) {
      continue;
    }
    (byCol[entry.col] = byCol[entry.col] || []).push(entry);
  }
  const cols = Object.keys(byCol);
  if (!cols.length) {
    throw new Error('SegRoulette: no series match the filter');
  }
  const list = byCol[cols[Math.floor(Math.random() * cols.length)]];
  return list[Math.floor(Math.random() * list.length)];
}

export function buildViewerPath(entry: SegRouletteEntry): string {
  const params = new URLSearchParams();
  params.append('StudyInstanceUIDs', entry.st);
  if (entry.u) {
    params.append('seriesInstanceUID', entry.u);
  }
  if (entry.su) {
    params.append('seriesInstanceUID', entry.su);
  }
  params.set('hangingProtocolId', 'only3D');
  return `viewer/idc?${params.toString()}`;
}

export type SegRouletteAutoHydrateRequest = {
  studyInstanceUID: string;
  segSeriesInstanceUID: string;
};

export const SEGROULETTE_AUTO_HYDRATE_KEY = 'ohif.segRoulette.autoHydrate';
/** Dim CT/MR volume after auto-hydrate so SEG is readable (only if still full opacity). */
export const SEGROULETTE_AUTO_DIM_OPACITY = 0.35;

export function setSegRouletteAutoHydrate(request: SegRouletteAutoHydrateRequest): void {
  try {
    sessionStorage.setItem(SEGROULETTE_AUTO_HYDRATE_KEY, JSON.stringify(request));
  } catch {
    // ignore quota / private-mode failures
  }
}

export function peekSegRouletteAutoHydrate(): SegRouletteAutoHydrateRequest | null {
  try {
    const raw = sessionStorage.getItem(SEGROULETTE_AUTO_HYDRATE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed?.studyInstanceUID || !parsed?.segSeriesInstanceUID) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearSegRouletteAutoHydrate(): void {
  try {
    sessionStorage.removeItem(SEGROULETTE_AUTO_HYDRATE_KEY);
  } catch {
    // ignore
  }
}

/** Soften the volume only when the user has not already changed opacity. */
function maybeAutoDimVolume(viewportId: string): void {
  if (!getSlicerLiveVolume3D(viewportId)) {
    return;
  }
  const current = getSlicerLiveVolume3DVolumeOpacity(viewportId);
  if (current === undefined || current < 0.999) {
    return;
  }
  setSlicerLiveVolume3DVolumeOpacity(viewportId, SEGROULETTE_AUTO_DIM_OPACITY);
}

/**
 * After SegRoulette navigation: wait for the only3D volume viewport + SEG
 * display set, then hydrate the SEG automatically (no confirm dialog).
 */
export function startSegRouletteAutoHydrate({
  servicesManager,
  commandsManager,
}: {
  servicesManager: AppTypes.ServicesManager;
  commandsManager: AppTypes.CommandsManager;
}): () => void {
  const { displaySetService, viewportGridService, hangingProtocolService } =
    servicesManager.services;

  let inFlight = false;
  let disposed = false;

  const tryHydrate = async () => {
    if (disposed || inFlight) {
      return;
    }

    const pending = peekSegRouletteAutoHydrate();
    if (!pending) {
      return;
    }

    const protocolId = hangingProtocolService?.getState?.()?.protocolId;
    if (protocolId && protocolId !== 'only3D') {
      return;
    }

    const { activeViewportId, viewports } = viewportGridService.getState();
    if (!activeViewportId) {
      return;
    }

    const viewport = viewports.get(activeViewportId);
    const volumeUIDs = viewport?.displaySetInstanceUIDs || [];
    const hasVolume = volumeUIDs.some(uid => {
      const ds = displaySetService.getDisplaySetByUID(uid);
      return ds && ds.Modality !== 'SEG' && ds.Modality !== 'RTSTRUCT' && ds.isReconstructable;
    });
    if (!hasVolume) {
      return;
    }

    const allDisplaySets = displaySetService.getActiveDisplaySets?.() ?? [];
    const segDisplaySet = allDisplaySets.find(
      ds =>
        ds.Modality === 'SEG' &&
        ds.SeriesInstanceUID === pending.segSeriesInstanceUID &&
        (!ds.StudyInstanceUID || ds.StudyInstanceUID === pending.studyInstanceUID)
    );

    if (!segDisplaySet) {
      return;
    }

    if (segDisplaySet.isHydrated) {
      maybeAutoDimVolume(activeViewportId);
      clearSegRouletteAutoHydrate();
      return;
    }

    inFlight = true;
    try {
      await commandsManager.runCommand('hydrateSecondaryDisplaySet', {
        displaySet: segDisplaySet,
        viewportId: activeViewportId,
      });
      maybeAutoDimVolume(activeViewportId);
      clearSegRouletteAutoHydrate();
    } catch (error) {
      console.error('SegRoulette auto-hydrate failed', error);
    } finally {
      inFlight = false;
    }
  };

  const subs = [
    displaySetService.subscribe(displaySetService.EVENTS.DISPLAY_SETS_ADDED, () => {
      void tryHydrate();
    }),
    displaySetService.subscribe(displaySetService.EVENTS.DISPLAY_SETS_CHANGED, () => {
      void tryHydrate();
    }),
    viewportGridService.subscribe(viewportGridService.EVENTS.VIEWPORTS_READY, () => {
      void tryHydrate();
    }),
  ];

  void tryHydrate();

  return () => {
    disposed = true;
    subs.forEach(sub => sub.unsubscribe());
  };
}
