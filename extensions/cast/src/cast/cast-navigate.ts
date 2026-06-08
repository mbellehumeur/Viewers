import { history } from '@ohif/app';
import { CAST_LOCAL_DATA_SOURCE } from './constants';

function getRouterBasename(): string {
  const configBasename = (
    window as { config?: { routerBasename?: string } }
  ).config?.routerBasename;
  const publicUrl = process.env.PUBLIC_URL;
  const basename = configBasename || publicUrl || '/';
  return basename.endsWith('/') ? basename.slice(0, -1) : basename;
}

export type CastNavigateOptions = {
  replace?: boolean;
};

/**
 * Navigate to an OHIF route. Uses React Router when available; falls back to
 * a full page load when Cast connects before RouteWithErrorBoundary wires history.
 */
export function castNavigate(to: string, options?: CastNavigateOptions): void {
  const route = to.startsWith('/') ? to : `/${to}`;

  const navigate = history?.navigate;
  if (typeof navigate === 'function') {
    navigate(route, options);
    return;
  }

  const basename = getRouterBasename();
  const target = `${basename}${route}`.replace(/\/{2,}/g, '/');
  if (options?.replace) {
    window.location.replace(target);
  } else {
    window.location.assign(target);
  }
}

export function navigateToCastEmptyViewer(options?: CastNavigateOptions): void {
  castNavigate('/viewer', options);
}

export function navigateToCastViewer(
  studyUIDs: string[],
  options?: {
    seriesUID?: string;
    dataSource?: string;
    useLocalDataSource?: boolean;
  }
): void {
  if (!studyUIDs.length) {
    return;
  }

  const query = new URLSearchParams();
  studyUIDs.forEach(uid => query.append('StudyInstanceUIDs', uid));
  const dataSource =
    options?.dataSource ??
    (options?.useLocalDataSource !== false ? CAST_LOCAL_DATA_SOURCE : undefined);
  if (dataSource) {
    query.append('datasources', dataSource);
  }
  if (options?.seriesUID) {
    query.append('SeriesInstanceUIDs', options.seriesUID);
  }

  castNavigate(`/viewer?${query.toString()}`);
}
