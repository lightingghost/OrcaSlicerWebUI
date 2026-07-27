/**
 * ProcessObjectsList Component
 *
 * The "Objects" side of the Process section's Global/Objects toggle (see
 * ProcessSelector.tsx) — matches native OrcaSlicer's own Process panel,
 * which replaces the profile dropdown with a searchable list of every
 * object on the plate once "Objects" is selected. Clicking a row:
 *   1. Selects that object in the Three.js viewport (setSelectedObjectId),
 *      which highlights it via ThreeViewport's existing selection-outline
 *      mechanism (BoxHelper) — no new highlight code needed here.
 *   2. Sets parameterSlice's `processTarget` to that object's file_id, so
 *      ParameterField/ParameterPanel below switch to reading/writing that
 *      object's own overrides instead of the global ones.
 *
 * Clicking "Plate 1" (or the empty area) returns to editing Global.
 */

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useStore } from '../../store';

export const ProcessObjectsList: React.FC = () => {
  const {
    uploadedFiles,
    setSelectedObjectId,
    processTarget,
    setProcessTarget,
    objectValidationErrors,
  } = useStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [isPlateExpanded, setIsPlateExpanded] = useState(true);

  const filteredFiles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return uploadedFiles;
    return uploadedFiles.filter((f) => f.filename.toLowerCase().includes(query));
  }, [uploadedFiles, searchQuery]);

  const handleSelectObject = (fileId: string) => {
    setSelectedObjectId(fileId);
    setProcessTarget(fileId);
  };

  return (
    <div className="border border-gray-700 rounded bg-gray-900/40">
      {/* Search */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-gray-700">
        <Search className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search plate, object and part."
          className="flex-1 min-w-0 bg-transparent text-xs text-gray-300 placeholder-gray-500
            focus:outline-none"
        />
      </div>

      {/* Plate group header — clicking it (not an object row) returns to Global */}
      <button
        type="button"
        onClick={() => setProcessTarget('global')}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-gray-300
          hover:bg-gray-800/60 transition-colors"
      >
        <span
          onClick={(e) => {
            e.stopPropagation();
            setIsPlateExpanded((prev) => !prev);
          }}
          className="flex-shrink-0"
        >
          {isPlateExpanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </span>
        Plate 1
      </button>

      {/* Object list */}
      {isPlateExpanded && (
        <div className="max-h-48 overflow-y-auto">
          {filteredFiles.length === 0 ? (
            <p className="px-3 py-3 text-xs text-gray-500">
              {uploadedFiles.length === 0 ? 'No objects on the plate' : 'No matches'}
            </p>
          ) : (
            filteredFiles.map((file) => {
              const isSelected = processTarget === file.file_id;
              const hasErrors = Object.keys(objectValidationErrors[file.file_id] ?? {}).length > 0;
              return (
                <button
                  key={file.file_id}
                  type="button"
                  onClick={() => handleSelectObject(file.file_id)}
                  title={file.filename}
                  className={`w-full flex items-center gap-2 pl-6 pr-2 py-1.5 text-xs text-left
                    transition-colors truncate ${
                    isSelected
                      ? 'bg-orange-600/80 text-white'
                      : 'text-gray-300 hover:bg-gray-800/60'
                  }`}
                >
                  <span className="flex-1 min-w-0 truncate">{file.filename}</span>
                  {hasErrors && (
                    <span className="text-red-300 flex-shrink-0" title="Invalid parameter value(s)">
                      !
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
