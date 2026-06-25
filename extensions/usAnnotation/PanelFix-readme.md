# usAnnotation — panel & JSON fixes

Ultrasound pleura / B-line annotation extension for OHIF, aligned with Slicer **AnnotateUltrasound** JSON (`annotations.schema.json`).

## Commit summary

This change set adds Slicer-compatible JSON import/export, multi-rater support, and several runtime/UI fixes.

### Bugs fixed

| Issue | Cause | Fix |
|-------|--------|-----|
| Imported lines did not align with images | Line points were treated as pixel indices instead of LPS world mm | `usAnnotationCoordinates.ts`: import via `slicerPointsToWorld`, export via `worldPointToSlicerLps` from tool handle world points |
| Fan overlay placed incorrectly after JSON import | Row/column swap vs Slicer; 2-element center missing Z | Import/export map `center_cols_px` ↔ `center[0]`, `center_rows_px` ↔ `center[1]`; apply fan via `updateFanGeometryConfiguration` |
| `ERROR [object Object]` on panel load | Zustand selector used `?? []`, creating a new array every render → infinite `useEffect` loop | Stable `EMPTY_FRAME_ANNOTATIONS` constant; `updateAnnotatedFrames` reads store via `getState()` |
| `Cannot destructure property 'modality' … as it is null` | `FanShapeGeometryProvider` returned `null` for unhandled metadata queries; Cornerstone stops the provider chain on any non-`undefined` value | Return `undefined` when query is not `ultrasoundFanShapeGeometry` |
| `Failed to import annotation JSON` after successful import | Stale `setLabels()` call after Annotation labels UI was removed | Removed call; labels stored in Zustand on `mergeImport`; export reads `merged.AnnotationLabels` |
| Frame table had no scrollbar | Accordion expanded to full table height; `ScrollArea` had no bounded height | Viewport-based `maxHeight` on table container + `ohif-scrollbar` |

### Features added

- **Slicer JSON format**: array-based `frame_annotations`, LPS line points, fan geometry fields, `AnnotationLabels`
- **Multi-rater workflow**: rater dropdown, merge import (re-import replaces same rater only), viewport filtered by selected rater
- **Commands**: `importJSON`, `downloadJSON`, `syncUSAnnotationsToStore`, `setUSAnnotationSelectedRater`, `refreshUSAnnotationViewportForSelectedRater`
- **Auto-tag rater** on new annotations when a rater is selected (`init.ts` + `ANNOTATION_COMPLETED`)
- **Panel layout**: JSON import/export in Workflow; overlay toggle under pleura percentage; Pleura/B-line tools under rater controls; scrollable frame table (no index column)

### Files touched

| File | Change |
|------|--------|
| `extensions/usAnnotation/PanelFix-readme.md` | This document |
| `extensions/usAnnotation/src/utils/usAnnotationJson.ts` | **New** — parse, serialize, merge frames, panel rows, validation |
| `extensions/usAnnotation/src/utils/usAnnotationCoordinates.ts` | **New** — LPS/RAS ↔ Cornerstone world |
| `extensions/usAnnotation/src/utils/applyUSAnnotationToViewport.ts` | **New** — hydrate JSON lines onto viewport |
| `extensions/usAnnotation/src/utils/syncViewportToMergedFrames.ts` | **New** — sync live viewport → merged store before rater switch/export |
| `extensions/usAnnotation/src/stores/useUSAnnotationStore.ts` | **New** — Zustand store for merged JSON, raters, selected rater |
| `extensions/usAnnotation/src/getCommandsModule.ts` | Import/export, fan geometry, multi-rater commands |
| `extensions/usAnnotation/src/panels/USAnnotationPanel.tsx` | Rater UI, table scroll, layout, import/export wiring |
| `extensions/usAnnotation/src/init/init.ts` | Fan metadata provider registration; tag rater on annotation complete |
| `extensions/usAnnotation/src/index.ts` | Wire `preRegistration` |
| `extensions/usAnnotation/src/providers/FanShapeGeometryProvider.ts` | Metadata provider fix (`undefined` vs `null`) |
| `extensions/usAnnotation/src/fixtures/exampleRating.json` | **New** — Slicer-format test fixture |
| `modes/usAnnotation/src/exampleRating.json` | **New** — mode-level copy of test fixture |
| `platform/i18n/src/locales/en-US/USAnnotationPanel.json` | Rater dropdown strings |

### JSON conventions (Slicer ↔ OHIF)

- **Line points**: LPS world `[x, y, z]` per point; `rater` on each line
- **Fan geometry**: pixel fields `center_rows_px`, `center_cols_px`, `angle1`, `angle2`, `radius1`, `radius2`
- **Tool internal center**: `[col, row, 0]` (IJK-style for `UltrasoundPleuraBLineTool`)

### Import / export flow

1. **Import** — Workflow → Import JSON → `mergeImport` → optional fan geometry → viewport refresh for selected rater
2. **Rater switch** — sync current viewport to store → update selection → re-hydrate viewport for that rater
3. **Export** — sync store → serialize selected rater only → download `ultrasound_annotations_{rater}_{date}.json`

## Hotkey + panel sync

See [HOTKEY_ANNOTATION_TYPE_SYNC.md](./HOTKEY_ANNOTATION_TYPE_SYNC.md) for pleura/B-line hotkeys and panel tab synchronization.

## Author

OHIF

## License

MIT
