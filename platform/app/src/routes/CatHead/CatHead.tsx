import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSystem } from '@ohif/core';
import { useAppConfig } from '@state';

import filesToStudies from '../Local/filesToStudies';
import { publicUrl } from '../../utils/publicUrl';
import useSearchParams from '../../hooks/useSearchParams';
import ModeRoute from '../Mode/Mode';

type LoadState = 'loading' | 'ready' | 'error';

function joinPublicPath(...parts: string[]): string {
  const base = publicUrl.endsWith('/') ? publicUrl.slice(0, -1) : publicUrl;
  const path = parts
    .map(part => String(part).replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return `${base}/${path}`;
}

function buildViewerQuery(studyUIDs: string[], existingSearch: string): URLSearchParams {
  const existing = new URLSearchParams(existingSearch);
  const query = new URLSearchParams();

  studyUIDs.forEach(id => query.append('StudyInstanceUIDs', id));
  query.set('datasources', 'dicomlocal');
  query.set('hangingProtocolId', 'only3D');

  for (const [key, value] of existing) {
    if (key === 'StudyInstanceUIDs' || key === 'datasources' || key === 'hangingProtocolId') {
      continue;
    }
    query.append(key, value);
  }

  return query;
}

/**
 * Fixed demo page that auto-loads bundled Cat Head DICOM files via the
 * dicomlocal pipeline (same File → filesToStudies path as drag-and-drop).
 *
 * Expects assets under `public/cat-head/`:
 * - `manifest.json`: string[] of filenames (relative to that folder)
 * - the listed `.dcm` (or extensionless) instance files
 *
 * After load, stays on `/cathead?…` so refresh re-fetches and re-indexes the
 * bundled files before opening the viewer.
 */
function CatHead() {
  const navigate = useNavigate();
  const location = useLocation();
  const query = useSearchParams();
  const [appConfig] = useAppConfig();
  const { extensionManager, servicesManager, commandsManager, hotkeysManager } = useSystem();
  const { customizationService } = servicesManager.services;
  const [state, setState] = useState<LoadState>('loading');
  const [message, setMessage] = useState('Loading Cat Head DICOM files…');

  const studyUIDsInUrl = query.getAll('StudyInstanceUIDs');
  const hasViewerQuery = studyUIDsInUrl.length > 0;
  const viewerMode = appConfig?.loadedModes?.find(mode => mode.routeName === 'viewer');

  const LoadingIndicatorProgress = customizationService.getCustomization(
    'ui.loadingIndicatorProgress'
  );

  useEffect(() => {
    document.body.classList.add('bg-background');
    return () => {
      document.body.classList.remove('bg-background');
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadCatHead() {
      try {
        setState('loading');
        setMessage('Loading Cat Head DICOM files…');

        const manifestUrl = joinPublicPath('cat-head', 'manifest.json');
        const manifestResponse = await fetch(manifestUrl);

        if (!manifestResponse.ok) {
          throw new Error(
            `Missing ${manifestUrl}. Add Cat Head DICOM files under public/cat-head/ and generate manifest.json (see public/cat-head/README.md).`
          );
        }

        const fileNames = (await manifestResponse.json()) as unknown;

        if (!Array.isArray(fileNames) || fileNames.length === 0) {
          throw new Error(
            'cat-head/manifest.json must be a non-empty JSON array of filenames.'
          );
        }

        setMessage(`Fetching ${fileNames.length} DICOM files…`);

        const files = await Promise.all(
          fileNames.map(async (name, index) => {
            const fileName = String(name);
            const fileUrl = joinPublicPath('cat-head', fileName);
            const response = await fetch(fileUrl);

            if (!response.ok) {
              throw new Error(`Failed to fetch ${fileUrl} (${response.status})`);
            }

            const blob = await response.blob();
            const baseName = fileName.split('/').pop() || `instance-${index}.dcm`;

            return new File([blob], baseName, {
              type: 'application/dicom',
            });
          })
        );

        if (cancelled) {
          return;
        }

        setMessage('Indexing study metadata…');
        const studyUIDs = await filesToStudies(files);

        if (cancelled) {
          return;
        }

        if (!studyUIDs?.length) {
          throw new Error(
            'No StudyInstanceUIDs found after loading Cat Head files. Check that the DICOM instances are valid.'
          );
        }

        const alreadyHasViewerQuery =
          new URLSearchParams(location.search).getAll('StudyInstanceUIDs').length > 0;

        if (!alreadyHasViewerQuery) {
          const viewerQuery = buildViewerQuery(studyUIDs, location.search);
          navigate(`/cathead?${viewerQuery.toString()}`, { replace: true });
        }

        setState('ready');
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error('[CatHead]', error);
        setState('error');
        setMessage(error instanceof Error ? error.message : String(error));
      }
    }

    void loadCatHead();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (state === 'ready' && hasViewerQuery && viewerMode) {
    return (
      <ModeRoute
        mode={viewerMode}
        dataSourceName="dicomlocal"
        extensionManager={extensionManager}
        servicesManager={servicesManager}
        commandsManager={commandsManager}
        hotkeysManager={hotkeysManager}
      />
    );
  }

  if (state === 'ready' && hasViewerQuery && !viewerMode) {
    return (
      <div className="text-foreground flex h-screen w-screen items-center justify-center">
        <div className="bg-muted border-primary/60 mx-auto max-w-xl space-y-4 rounded-xl border border-dashed px-10 py-12 text-center drop-shadow-md">
          <h1 className="text-primary text-2xl">Cat Head</h1>
          <p className="text-destructive text-sm">
            Viewer mode is not available. Check that the longitudinal viewer mode is
            registered in app config.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="text-foreground flex h-screen w-screen items-center justify-center">
      <div className="bg-muted border-primary/60 mx-auto max-w-xl space-y-4 rounded-xl border border-dashed px-10 py-12 text-center drop-shadow-md">
        <h1 className="text-primary text-2xl">Cat Head</h1>
        {state === 'loading' ? (
          <div className="flex flex-col items-center justify-center space-y-4 pt-4">
            <div className="h-24 w-full">
              {LoadingIndicatorProgress ? (
                <LoadingIndicatorProgress className="h-full w-full bg-background" />
              ) : null}
            </div>
            <p className="text-muted-foreground text-sm">{message}</p>
          </div>
        ) : (
          <div className="space-y-3 pt-2">
            <p className="text-destructive text-sm whitespace-pre-wrap">{message}</p>
            <p className="text-muted-foreground text-xs">
              Place DICOM files in{' '}
              <code>platform/app/public/cat-head/</code>, then regenerate{' '}
              <code>manifest.json</code>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default CatHead;
