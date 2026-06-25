# Hotkey annotation type sync (pleura / B-line)

This document explains how to fix ultrasound pleura/B-line hotkeys so they **activate the tool**, **switch annotation mode**, and **update the side panel UI**. Use it to port the same fix into another OHIF fork or repo.

## Hotkey reference

OHIF uses [Mousetrap.js](https://craig.is/killing/mice) syntax: **use lowercase letters** for plain key presses. Uppercase (e.g. `'W'`) means Shift+key.

| Key | Command | Action |
|-----|---------|--------|
| `w` | `switchUSAnnotationToPleuraLine` | Activate tool + switch to pleura line |
| `s` | `switchUSAnnotationToBLine` | Activate tool + switch to B-line |
| `e` | `deleteLastPleuraAnnotation` | Delete last pleura line |
| `d` | `deleteLastBLineAnnotation` | Delete last B-line |
| `O` (Shift+o) | `toggleDisplayFanAnnotation` | Toggle overlay |

## Problem

Hotkeys (`W` = pleura line, `S` = B-line) were registered in the mode but only called `setActiveAnnotationType()` on the Cornerstone tool instance. That caused three issues:

1. **Tool not activated** – If Pan/Zoom/another tool was active, hotkeys changed internal mode but drawing still used the wrong tool.
2. **No visible UI change** – The panel used uncontrolled `<Tabs defaultValue="bLine">`, so hotkeys never updated the selected tab.
3. **Silent mode switch** – `setActiveAnnotationType()` only affects **new** drawings (pleura = blue, B-line = green). Existing lines are unchanged.

## Architecture

```
User presses W
  → HotkeysManager (modes/usAnnotation/src/index.ts)
  → commandsManager.runCommand('switchUSAnnotationToPleuraLine')
  → getCommandsModule.switchUSPleuraBLineAnnotation
       1. setToolActive(UltrasoundPleuraBLineTool)
       2. tool.setActiveAnnotationType('pleura')
       3. triggerEvent(ANNOTATION_TYPE_CHANGED)
  → USAnnotationPanel listens → updates controlled Tabs
```

## Files changed in this repo

| File | Change |
|------|--------|
| `extensions/usAnnotation/src/events.ts` | **New** – shared event name constant |
| `extensions/usAnnotation/src/getCommandsModule.ts` | Activate tool, emit event after type switch |
| `extensions/usAnnotation/src/panels/USAnnotationPanel.tsx` | Controlled tabs + sync from tool/events |
| `modes/usAnnotation/src/index.ts` | Hotkey bindings (unchanged; already defines `W` / `S`) |

## Step-by-step porting guide

### 1. Register hotkeys in your mode (if not already)

In your mode's `onModeEnter`, push bindings via the customization service:

```typescript
customizationService.setCustomizations({
  'ohif.hotkeyBindings': {
    $push: [
      { commandName: 'switchUSAnnotationToPleuraLine', label: 'Add new pleura line', keys: ['w'] },
      { commandName: 'switchUSAnnotationToBLine', label: 'Add new B-line', keys: ['s'] },
      { commandName: 'deleteLastPleuraAnnotation', label: 'Delete last pleura line', keys: ['e'] },
      { commandName: 'deleteLastBLineAnnotation', label: 'Delete last B-line', keys: ['d'] },
      { commandName: 'toggleDisplayFanAnnotation', label: 'Toggle overlay', keys: ['O'] },
    ],
  },
}, 'mode');
```

Command names must match definitions in your extension's `getCommandsModule.ts`.

### 2. Add a shared event constant

Create `extensions/<your-extension>/src/events.ts`:

```typescript
export const US_ANNOTATION_EVENTS = {
  ANNOTATION_TYPE_CHANGED: 'event::us_annotation_annotation_type_changed',
} as const;
```

Use a unique event string to avoid collisions with other extensions.

### 3. Update the switch command

In `getCommandsModule.ts`, inject `commandsManager` and `toolbarService`, activate the tool **directly on the viewport tool group**, then refresh the toolbar:

```typescript
import { eventTarget, triggerEvent } from '@cornerstonejs/core';
import { UltrasoundPleuraBLineTool, Enums as csToolsEnums } from '@cornerstonejs/tools';
import { US_ANNOTATION_EVENTS } from './events';

function commandsModule({ servicesManager, commandsManager }) {
  const { viewportGridService, toolGroupService, toolbarService } = servicesManager.services;

  const activateUSPleuraBLineTool = (viewportId?: string) => {
    const activeViewportId = viewportId ?? viewportGridService.getActiveViewportId();
    const toolGroup = toolGroupService.getToolGroupForViewport(activeViewportId);

    if (!toolGroup?.hasTool(UltrasoundPleuraBLineTool.toolName)) {
      return false;
    }

    const activeToolName = toolGroup.getActivePrimaryMouseButtonTool();
    if (activeToolName) {
      const activeToolOptions = toolGroup.getToolConfiguration(activeToolName);
      activeToolOptions?.disableOnPassive
        ? toolGroup.setToolDisabled(activeToolName)
        : toolGroup.setToolPassive(activeToolName);
    }

    toolGroup.setToolActive(UltrasoundPleuraBLineTool.toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],
    });

    // Required so the More Tools menu highlights the US annotation button
    toolbarService.refreshToolbarState({
      viewportId: activeViewportId,
      toolGroupId: toolGroup.id,
    });

    return true;
  };

  const actions = {
    switchUSPleuraBLineAnnotation: ({ annotationType }) => {
      const activeViewportId = viewportGridService.getActiveViewportId();
      const activated = activateUSPleuraBLineTool(activeViewportId);

      if (!activated) {
        commandsManager.runCommand(
          'setToolActiveToolbar',
          { toolName: UltrasoundPleuraBLineTool.toolName },
          'CORNERSTONE'
        );
      }

      const toolGroup = toolGroupService.getToolGroupForViewport(activeViewportId);
      const usAnnotation = toolGroup?.getToolInstance(UltrasoundPleuraBLineTool.toolName);
      if (!usAnnotation) {
        return;
      }

      usAnnotation.setActiveAnnotationType(annotationType);

      triggerEvent(eventTarget, US_ANNOTATION_EVENTS.ANNOTATION_TYPE_CHANGED, {
        annotationType,
        viewportId: activeViewportId,
      });
    },
    // convenience commands switchUSAnnotationToPleuraLine / switchUSAnnotationToBLine ...
  };
}
```

**Why not only `commandsManager.runCommand('setToolActive')`?** That can return early without error when the tool group lookup fails, and it does not refresh the toolbar. Direct activation plus `toolbarService.refreshToolbarState()` ensures the More Tools button shows as selected.

**Do not** add the same tool to both `active` and `passive` in `initToolGroups` — `addTool` would be called twice for the same tool name.

### 4. Fix the panel – use controlled tabs

Replace uncontrolled tabs:

```tsx
// Before (broken with hotkeys)
<Tabs defaultValue={BLINE} onValueChange={switchAnnotation}>

// After
<Tabs value={activeAnnotationType} onValueChange={switchAnnotation}>
```

Add state and sync logic:

```tsx
const [activeAnnotationType, setActiveAnnotationType] = useState(BLINE);

const readActiveAnnotationTypeFromTool = useCallback(() => {
  const viewportId = viewportGridService.getActiveViewportId();
  const toolGroup = toolGroupService.getToolGroupForViewport(viewportId);
  const tool = toolGroup?.getToolInstance(UltrasoundPleuraBLineTool.toolName);
  return tool?.getActiveAnnotationType() ?? null;
}, [viewportGridService, toolGroupService]);

// Initial + viewport change sync
useEffect(() => {
  const type = readActiveAnnotationTypeFromTool();
  if (type) setActiveAnnotationType(type);
}, [readActiveAnnotationTypeFromTool]);

useEffect(() => {
  const { unsubscribe } = viewportGridService.subscribe(
    viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
    () => {
      const type = readActiveAnnotationTypeFromTool();
      if (type) setActiveAnnotationType(type);
    }
  );
  return unsubscribe;
}, [viewportGridService, readActiveAnnotationTypeFromTool]);

// Hotkey / command sync
useEffect(() => {
  const handler = (e: CustomEvent<{ annotationType: string }>) => {
    setActiveAnnotationType(e.detail.annotationType);
  };
  eventTarget.addEventListener(US_ANNOTATION_EVENTS.ANNOTATION_TYPE_CHANGED, handler);
  return () =>
    eventTarget.removeEventListener(US_ANNOTATION_EVENTS.ANNOTATION_TYPE_CHANGED, handler);
}, []);

// Panel clicks – optimistic tab update + single command path
const switchAnnotation = (type: string) => {
  setActiveAnnotationType(type);
  commandsManager.runCommand('switchUSAnnotation', { annotationType: type });
};

// Hotkey sync (backup if custom event is missed)
useEffect(() => {
  const { unsubscribe } = hotkeysManager.subscribe(
    HotkeysManager.EVENTS.HOTKEY_PRESSED,
    ({ commandName }) => {
      if (commandName === 'switchUSAnnotationToPleuraLine') {
        setActiveAnnotationType(PLEURA);
      } else if (commandName === 'switchUSAnnotationToBLine') {
        setActiveAnnotationType(BLINE);
      }
    }
  );
  return unsubscribe;
}, [hotkeysManager]);
```

Remove duplicate `setToolActive` calls from the panel; activation lives in the command.

## Verification

1. Open US annotation mode with an ultrasound study.
2. Activate Pan or Zoom.
3. Press `W` – US annotation tool should become active; panel tab should show **Pleura line**.
4. Draw a line – it should be **blue** (pleura).
5. Press `S` – tab should switch to **B-line**; new lines should be **green**.
6. Click panel tabs – same behavior as hotkeys.

## Tool API reference (@cornerstonejs/tools)

`UltrasoundPleuraBLineTool` exposes:

- `USPleuraBLineAnnotationType.PLEURA` → `'pleura'`
- `USPleuraBLineAnnotationType.BLINE` → `'bLine'`
- `setActiveAnnotationType(type)` – sets mode for the **next** annotation
- `getActiveAnnotationType()` – reads current mode

Default colors (tool configuration):

- Pleura: `rgb(0, 4, 255)`
- B-line: `rgb(60, 255, 60)`

## Optional improvements

- Show a toast when the mode changes via hotkey.
- Add a viewport overlay indicating current mode (pleura vs B-line).
- Sync all tool group instances if your app activates the tool across multiple groups (`setToolActiveToolbar` with several `toolGroupIds`).

## Related locations

- Hotkey definitions: `modes/usAnnotation/src/index.ts`
- Command module: `extensions/usAnnotation/src/getCommandsModule.ts`
- Panel UI: `extensions/usAnnotation/src/panels/USAnnotationPanel.tsx`
- Tool registration alias: `extensions/cornerstone/src/initCornerstoneTools.js` (`UltrasoundAnnotation` → `UltrasoundPleuraBLineTool.toolName`)
- Hotkey infrastructure: `platform/core/src/classes/HotkeysManager.ts`
