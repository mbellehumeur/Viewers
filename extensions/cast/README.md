# OHIF Cast extension

Cast hub client for OHIF (Image Display actor), aligned with VolView and vtk-js
`CastClient` STOW batch + `payloadId` HTTP fetch.

## Build order

1. Build vtk-js ESM: from `ProjectWeek45/vtk-js`, produce `dist/esm`.
2. Install Viewers deps: `yarn install` in `ProjectWeek45/Viewers`.
3. Build OHIF for Cast hub:

```bash
cd platform/app
yarn build:cast-hub
```

4. Sync into SlicerCastInterface hub package:

```bash
python CastInterface/cast_api/make_zip.py
```

## Configuration

Use [`platform/app/public/config/cast.js`](../platform/app/public/config/cast.js) via
`APP_CONFIG=config/cast.js` and `PUBLIC_URL=/` (hub root; `routerBasename: null`).

The extension reads `window.config.cast` (hub list, `autoSelectHub`, `actors: ['ID']`).

## Protocol

- **Receive:** `dicom-send`, `nifti-send` — `fetchAllPayloads` then ingest (DICOM via
  `DicomMetadataStore`; NIfTI logged until a loader exists).
- **Publish:** `publishDicomSendSeries`, `publishDicomSendStudy` — STOW via vtk
  `publish()` with `context.files[]`.
- **Requests:** PNG/JPG thumbnails and `SCENEVIEW` (Image Display actor `ID`).
- **ImagingStudy:** open/close via vtk `imagingStudyContext` extractors. IDC direct
  load (`open-mode: idc`) ingests HTTPS `context.files` into the `idc` data source
  (memory-backed, not DICOMweb) with parallel bucket fetch.

Commands: `castPublishDicomSeries`, `castPublishDicomStudy` (context `CAST`).

## Source layout

- `src/services/CastService/CastService.ts` — service wiring
- `src/cast/` — shared helpers (mirrors VolView `src/io/cast/`)

See also [binary-file-transfer.md](../../../SlicerCastInterface/CastInterface/docs/binary-file-transfer.md).
