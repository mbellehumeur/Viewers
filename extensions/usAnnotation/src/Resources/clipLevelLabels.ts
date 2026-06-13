/** Clip-level label options (from SlicerUltrasound lung_labels.csv). */
export type ClipLevelLabelEntry = {
  category: string;
  label: string;
  value: string;
};

const CLIP_LEVEL_LABEL_ROWS: Array<[string, string]> = [
  ['anatomy', 'liver'],
  ['anatomy', 'spleen'],
  ['anatomy', 'heart'],
  ['pathology', 'effusion'],
  ['pathology', 'consolidation'],
  ['pathology', 'subpleural consolidation'],
  ['quality', 'good'],
  ['quality', 'limited'],
  ['quality', 'unusable'],
  ['zone', 'L1'],
  ['zone', 'L2'],
  ['zone', 'L3'],
  ['zone', 'L4'],
  ['zone', 'L4V'],
  ['zone', 'R1'],
  ['zone', 'R2'],
  ['zone', 'R3'],
  ['zone', 'R4'],
  ['zone', 'R4V'],
];

export const CLIP_LEVEL_LABEL_ENTRIES: ClipLevelLabelEntry[] = CLIP_LEVEL_LABEL_ROWS.map(
  ([category, label]) => ({
    category,
    label,
    value: `${category}/${label}`,
  })
);

export type ClipLevelLabelGroup = {
  category: string;
  displayCategory: string;
  labels: Array<{ label: string; displayLabel: string; value: string }>;
};

function humanizeToken(text: string): string {
  if (!text) {
    return text;
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function groupClipLevelLabels(): ClipLevelLabelGroup[] {
  const byCategory = new Map<string, ClipLevelLabelGroup>();

  CLIP_LEVEL_LABEL_ENTRIES.forEach(entry => {
    let group = byCategory.get(entry.category);
    if (!group) {
      group = {
        category: entry.category,
        displayCategory: humanizeToken(entry.category),
        labels: [],
      };
      byCategory.set(entry.category, group);
    }
    group.labels.push({
      label: entry.label,
      displayLabel: humanizeToken(entry.label),
      value: entry.value,
    });
  });

  return Array.from(byCategory.values());
}
