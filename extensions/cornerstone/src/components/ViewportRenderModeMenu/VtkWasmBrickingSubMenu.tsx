import React from 'react';
import {
  readWasmBrickPartitionOptionsForPath,
  resolveVtkWasmBrickPresetFromOptions,
  VTK_WASM_BRICK_PRESET_IDS,
  VTK_WASM_BRICK_PRESET_LABELS,
} from '@cornerstonejs/core';
import { Button, Icons } from '@ohif/ui-next';

type VtkWasmBrickPresetId = 'minimal' | '2x2x2' | '4x4x4' | '8x8x8';

type VtkWasmBrickingSubMenuProps = {
  path: 'mpr' | 'volume3d';
  currentPreset?: VtkWasmBrickPresetId;
  onBack: () => void;
  onSelect: (preset: VtkWasmBrickPresetId) => void;
};

function readActivePreset(path: 'mpr' | 'volume3d'): VtkWasmBrickPresetId | undefined {
  return resolveVtkWasmBrickPresetFromOptions(
    readWasmBrickPartitionOptionsForPath(path)
  );
}

function VtkWasmBrickingSubMenu({
  path,
  currentPreset,
  onBack,
  onSelect,
}: VtkWasmBrickingSubMenuProps) {
  const activePreset = currentPreset ?? readActivePreset(path);

  return (
    <>
      <Button
        variant="ghost"
        className="flex h-8 w-full flex-shrink-0 items-center justify-start self-stretch px-1 py-0 text-sm"
        onClick={onBack}
      >
        <div className="mr-1 flex w-6 items-center justify-start">
          <Icons.ArrowLeft className="text-primary h-5 w-5" />
        </div>
        <div className="flex-1 text-left font-medium">Bricking</div>
      </Button>
      {VTK_WASM_BRICK_PRESET_IDS.map(presetId => (
        <Button
          key={presetId}
          variant="ghost"
          className="flex h-8 w-full flex-shrink-0 items-center justify-start self-stretch px-1 py-0 text-sm"
          onClick={() => {
            onSelect(presetId);
          }}
        >
          <div className="mr-1 flex w-6 items-center justify-start">
            {activePreset === presetId ? (
              <Icons.Checked className="text-primary h-5 w-5" />
            ) : null}
          </div>
          <div className="flex-1 text-left">{VTK_WASM_BRICK_PRESET_LABELS[presetId]}</div>
        </Button>
      ))}
    </>
  );
}

export default VtkWasmBrickingSubMenu;
