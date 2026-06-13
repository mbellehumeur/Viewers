import React from 'react';
import { Switch } from '@ohif/ui-next';
import { groupClipLevelLabels } from '../Resources/clipLevelLabels';

type ClipLevelLabelsProps = {
  selectedLabels: string[];
  onChange: (labels: string[]) => void;
};

const CLIP_LEVEL_LABEL_GROUPS = groupClipLevelLabels();

export default function ClipLevelLabels({ selectedLabels, onChange }: ClipLevelLabelsProps) {
  const toggleLabel = (value: string, checked: boolean) => {
    if (checked) {
      if (!selectedLabels.includes(value)) {
        onChange([...selectedLabels, value]);
      }
      return;
    }
    onChange(selectedLabels.filter(item => item !== value));
  };

  const renderLabelRow = (
    groupCategory: string,
    item: { label: string; displayLabel: string; value: string }
  ) => {
    const inputId = `clip-label-${groupCategory}-${item.label}`.replace(/\s+/g, '-');
    const checked = selectedLabels.includes(item.value);
    return (
      <div key={item.value} className="flex items-center">
        <Switch
          id={inputId}
          className="mr-3"
          checked={checked}
          onCheckedChange={nextChecked => toggleLabel(item.value, nextChecked)}
        />
        <label htmlFor={inputId} className="cursor-pointer">
          {item.displayLabel}
        </label>
      </div>
    );
  };

  const renderLabelGroup = (group: (typeof CLIP_LEVEL_LABEL_GROUPS)[number]) => {
    if (group.category !== 'zone') {
      return (
        <div className="space-y-2 pl-1">
          {group.labels.map(item => renderLabelRow(group.category, item))}
        </div>
      );
    }

    const leftLabels = group.labels.filter(item => item.label.startsWith('L'));
    const rightLabels = group.labels.filter(item => item.label.startsWith('R'));

    return (
      <div className="grid grid-cols-2 gap-x-2 pl-1">
        <div className="space-y-2">{leftLabels.map(item => renderLabelRow(group.category, item))}</div>
        <div className="space-y-2">{rightLabels.map(item => renderLabelRow(group.category, item))}</div>
      </div>
    );
  };

  return (
    <div className="text-foreground space-y-3 p-2 text-sm">
      {CLIP_LEVEL_LABEL_GROUPS.map(group => (
        <div key={group.category}>
          <div className="text-muted-foreground mb-2 font-medium">{group.displayCategory}</div>
          {renderLabelGroup(group)}
        </div>
      ))}
    </div>
  );
}
