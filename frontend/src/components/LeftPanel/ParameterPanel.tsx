/**
 * ParameterPanel Component
 * 
 * Displays parameter fields filtered by the currently selected section,
 * organized into the same option groups (with group headers) and in the
 * same order as the native OrcaSlicer desktop UI (e.g. Quality -> "Layer
 * height", "Line width", "Seam", "Precision", ...).
 *
 * Only parameters that are actually part of the native `TabPrint::build()`
 * page/group structure (i.e. have a non-null `group`) are shown here. This
 * keeps each tab's contents an exact match for the native desktop UI's
 * Quality/Strength/Speed/Support/Multimaterial/Others pages, rather than
 * being diluted with unrelated printer- or filament-only settings that the
 * parser also tags with `section: 'other'` but that never appear on the
 * Process tab in the native app.
 */

import { useStore } from '../../store';
import { ParameterDescriptor } from '../../store/parameterSlice';
import { ParameterField } from './ParameterField';

interface ParameterPanelProps {
  section: 'quality' | 'strength' | 'speed' | 'support' | 'multi_material' | 'gcode' | 'other';
}

function sortDescriptors(descriptors: ParameterDescriptor[]): ParameterDescriptor[] {
  return [...descriptors].sort((a, b) => {
    const aHasGroup = a.group != null;
    const bHasGroup = b.group != null;
    if (aHasGroup !== bHasGroup) return aHasGroup ? -1 : 1;

    const aGroupOrder = a.group_order ?? 0;
    const bGroupOrder = b.group_order ?? 0;
    if (aGroupOrder !== bGroupOrder) return aGroupOrder - bGroupOrder;

    const aOrder = a.order ?? 0;
    const bOrder = b.order ?? 0;
    if (aOrder !== bOrder) return aOrder - bOrder;

    return a.key.localeCompare(b.key);
  });
}

/** Groups a sorted descriptor list into [groupTitle, descriptors][] pairs,
 * preserving order. Ungrouped descriptors are collected under "Other". */
function groupDescriptors(sorted: ParameterDescriptor[]): Array<[string, ParameterDescriptor[]]> {
  const groups: Array<[string, ParameterDescriptor[]]> = [];
  let currentTitle: string | null = null;
  let currentList: ParameterDescriptor[] = [];

  for (const descriptor of sorted) {
    const title = descriptor.group ?? 'Other';
    if (title !== currentTitle) {
      if (currentTitle !== null) {
        groups.push([currentTitle, currentList]);
      }
      currentTitle = title;
      currentList = [];
    }
    currentList.push(descriptor);
  }
  if (currentTitle !== null) {
    groups.push([currentTitle, currentList]);
  }
  return groups;
}

export const ParameterPanel: React.FC<ParameterPanelProps> = ({ section }) => {
  const { parameterDescriptors } = useStore();

  // Filter descriptors by section, keeping only parameters that belong to a
  // native UI option group. This excludes printer/filament-only settings
  // that the parser could not place on a Process tab page (they carry
  // section: 'other' as a fallback but have no `group`).
  const filteredDescriptors = parameterDescriptors.filter(
    (descriptor) => descriptor.section === section && descriptor.group != null
  );

  if (parameterDescriptors.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-gray-400 text-sm">Loading parameters...</p>
      </div>
    );
  }

  if (filteredDescriptors.length === 0) {
    return (
      <div className="p-4 text-center">
        <p className="text-gray-400 text-sm">No parameters in this section</p>
      </div>
    );
  }

  const sorted = sortDescriptors(filteredDescriptors);
  const groups = groupDescriptors(sorted);

  return (
    <div className="overflow-y-auto flex-1 min-h-0">
      {groups.map(([groupTitle, descriptors]) => (
        <div key={groupTitle}>
          <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 bg-gray-900/60 border-b border-gray-800 sticky top-0">
            {groupTitle}
          </div>
          {descriptors.map((descriptor) => (
            <ParameterField key={descriptor.key} descriptor={descriptor} />
          ))}
        </div>
      ))}
    </div>
  );
};
