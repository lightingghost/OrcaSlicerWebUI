/**
 * FilamentRow Component
 * 
 * Displays selected filament profiles as color swatches and provides
 * add/remove functionality for managing filament selections.
 * 
 * Features:
 * - FilamentSwatch[] showing color from default_filament_colour field
 * - AddFilamentButton opens modal to select from filament profiles
 * - RemoveFilamentButton removes last filament from array
 * - Modal with manufacturer and material type filters (populated from backend metadata)
 * - Wired to profileSlice.toggleFilamentProfile
 */

import { useState, useMemo, useEffect } from 'react';
import { useStore } from '../../store';
import { apiClient } from '../../api/client';
import { FilamentConfigDialog } from './FilamentConfigDialog';

/**
 * Extract material type from filament profile name (client-side fallback)
 */
function extractMaterialType(profileName: string): string {
  const upper = profileName.toUpperCase();
  
  // Check for composite materials first (order matters)
  if (upper.includes('PA-CF') || upper.includes('PA CF')) return 'PA-CF';
  if (upper.includes('PLA-CF') || upper.includes('PLA CF')) return 'PLA-CF';
  if (upper.includes('PETG-CF') || upper.includes('PETG CF')) return 'PETG-CF';
  if (upper.includes('PC-CF') || upper.includes('PC CF')) return 'PC-CF';
  if (upper.includes('PA-GF') || upper.includes('PA GF')) return 'PA-GF';
  
  // Check for basic materials
  if (upper.includes('PLA')) return 'PLA';
  if (upper.includes('PETG')) return 'PETG';
  if (upper.includes('ABS')) return 'ABS';
  if (upper.includes('ASA')) return 'ASA';
  if (upper.includes('TPU')) return 'TPU';
  if (upper.includes('NYLON') || upper.includes('PA')) return 'Nylon/PA';
  if (upper.includes('PC')) return 'PC';
  if (upper.includes('PVA')) return 'PVA';
  if (upper.includes('HIPS')) return 'HIPS';
  
  return 'Other';
}

interface FilamentPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  filamentProfiles: Array<{ name: string; path: string; category: string }>;
  selectedPaths: string[];
  onToggle: (profile: any) => void;
  selectedPrinterName: string | null;
}

interface FilamentProfileInfo {
  name: string;
  path: string;
  material_type: string;
  compatible_printers: string[];
}

interface FilamentMetadata {
  manufacturers: string[];
  material_types: string[];
  filaments: FilamentProfileInfo[];
}

const FilamentPickerModal: React.FC<FilamentPickerModalProps> = ({
  isOpen,
  onClose,
  filamentProfiles,
  selectedPaths,
  onToggle,
  selectedPrinterName,
}) => {
  const [filterManufacturer, setFilterManufacturer] = useState<string>('all');
  const [filterMaterial, setFilterMaterial] = useState<string>('all');
  const [filterCompatibility, setFilterCompatibility] = useState<'all' | 'compatible'>('all');
  const [metadata, setMetadata] = useState<FilamentMetadata | null>(null);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [userFilaments, setUserFilaments] = useState<Array<{ name: string; path: string }>>([]);

  // Fetch system filament metadata + user-saved filaments when modal opens
  useEffect(() => {
    if (!isOpen) return;

    // Fetch system filament metadata (only once)
    if (!metadata) {
      setIsLoadingMetadata(true);
      apiClient.getFilamentMetadata()
        .then((data) => { setMetadata(data); })
        .catch(err => {
          console.error('Failed to fetch filament metadata:', err);
          const manufacturers = new Set<string>();
          const materialTypes = new Set<string>();
          const fallbackFilaments: FilamentProfileInfo[] = [];
          filamentProfiles.forEach(profile => {
            const mfr = profile.path.match(/^([^/]+)\//)?.[1];
            if (mfr) manufacturers.add(mfr);
            const mat = extractMaterialType(profile.name);
            materialTypes.add(mat);
            fallbackFilaments.push({ name: profile.name, path: profile.path, material_type: mat, compatible_printers: [] });
          });
          setMetadata({ manufacturers: Array.from(manufacturers).sort(), material_types: Array.from(materialTypes).sort(), filaments: fallbackFilaments });
        })
        .finally(() => setIsLoadingMetadata(false));
    }

    // Fetch user-saved filament configs every time the modal opens
    apiClient.listFilamentConfigs()
      .then(configs => {
        // Use all non-autosave configs as user filaments
        const saved = configs.filter(c => !c.autosave).map(c => ({
          name: c.name,
          path: `user:${c.path}`,
        }));
        setUserFilaments(saved);
      })
      .catch(err => console.error('Failed to fetch user filaments:', err));
  }, [isOpen]);

  // Filter profiles based on selections
  const filteredProfiles = useMemo(() => {
    if (!metadata || !metadata.filaments) return [];
    
    return metadata.filaments.filter(profile => {
      // Filter by manufacturer (based on path)
      if (filterManufacturer !== 'all') {
        if (!profile.path.startsWith(filterManufacturer + '/')) {
          return false;
        }
      }
      
      // Filter by material type
      if (filterMaterial !== 'all') {
        if (profile.material_type !== filterMaterial) {
          return false;
        }
      }
      
      // Filter by compatibility
      if (filterCompatibility === 'compatible' && selectedPrinterName) {
        if (!profile.compatible_printers || !profile.compatible_printers.includes(selectedPrinterName)) {
          return false;
        }
      }
      
      return true;
    });
  }, [metadata, filterManufacturer, filterMaterial, filterCompatibility, selectedPrinterName]);

  if (!isOpen) return null;

  const totalProfiles = metadata?.filaments.length || 0;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-white">Select Filament Profiles</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-xl px-2"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Filters */}
        {isLoadingMetadata ? (
          <div className="text-center text-gray-400 py-4">Loading filament profiles...</div>
        ) : metadata && (
          <>
            <div className="grid grid-cols-3 gap-4 mb-4">
              {/* Manufacturer Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Manufacturer
                </label>
                <select
                  value={filterManufacturer}
                  onChange={(e) => setFilterManufacturer(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="all">All Manufacturers</option>
                  {metadata.manufacturers.map(manufacturer => (
                    <option key={manufacturer} value={manufacturer}>
                      {manufacturer}
                    </option>
                  ))}
                </select>
              </div>

              {/* Material Type Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Material Type
                </label>
                <select
                  value={filterMaterial}
                  onChange={(e) => setFilterMaterial(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="all">All Materials</option>
                  {metadata.material_types.map(type => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              {/* Compatibility Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Compatibility
                </label>
                <select
                  value={filterCompatibility}
                  onChange={(e) => setFilterCompatibility(e.target.value as 'all' | 'compatible')}
                  disabled={!selectedPrinterName}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={!selectedPrinterName ? 'Select a printer model first' : ''}
                >
                  <option value="all">All Filaments</option>
                  <option value="compatible">Compatible Only</option>
                </select>
                {selectedPrinterName && filterCompatibility === 'compatible' && (
                  <p className="text-xs text-gray-400 mt-1">
                    For: {selectedPrinterName}
                  </p>
                )}
              </div>
            </div>

            {/* Filtered count */}
            <div className="text-sm text-gray-400 mb-3">
              Showing {filteredProfiles.length} of {totalProfiles} profiles
            </div>
          </>
        )}

        {/* Profile List */}
        <div className="space-y-2 max-h-[40vh] overflow-y-auto">
          {filteredProfiles.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">
              {isLoadingMetadata
                ? 'Loading...'
                : totalProfiles === 0
                ? 'No filament profiles available'
                : 'No filament profiles match your filters'}
            </p>
          ) : (
            filteredProfiles.map((profile) => {
              const isSelected = selectedPaths.includes(profile.path);
              
              return (
                <button
                  key={profile.path}
                  onClick={() => onToggle(profile)}
                  className={`w-full p-3 rounded text-left transition-colors ${
                    isSelected
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium block truncate">
                        {profile.name}
                      </span>
                      <span className="text-xs text-gray-400 block mt-1">
                        {profile.material_type}
                      </span>
                    </div>
                    {isSelected && (
                      <span className="text-xs bg-purple-800 px-2 py-1 rounded ml-2 flex-shrink-0">
                        ✓ Selected
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* User-saved filaments */}
        {userFilaments.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                My saved filaments
              </span>
              <div className="flex-1 h-px bg-gray-700" />
            </div>
            <div className="space-y-2">
              {userFilaments.map(uf => {
                const isSelected = selectedPaths.includes(uf.path);
                return (
                  <button key={uf.path} onClick={() => onToggle({ ...uf, category: 'filament', isUserConfig: true })}
                    className={`w-full p-3 rounded text-left transition-colors ${
                      isSelected ? 'bg-purple-600 text-white' : 'bg-gray-700/80 text-gray-200 hover:bg-gray-600 border border-dashed border-gray-600'
                    }`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium truncate">{uf.name}</span>
                      <span className="text-xs bg-teal-700 text-teal-100 px-2 py-0.5 rounded ml-2 flex-shrink-0">
                        user
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <button
          onClick={onClose}
          className="mt-6 w-full px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
};

interface FilamentSwatchProps {
  profile: { name: string; path: string };
  color?: string;
  onRemove: () => void;
  onEdit: () => void;
}

const FilamentSwatch: React.FC<FilamentSwatchProps> = ({ profile, color, onRemove, onEdit }) => {
  const displayColor = color && color.startsWith('#') ? color : '#8B8B8B';

  return (
    <div
      className="group relative flex items-center gap-2 p-2 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
      title={profile.name}
    >
      {/* Color swatch circle */}
      <div
        className="w-6 h-6 rounded-full border-2 border-gray-500 flex-shrink-0"
        style={{ backgroundColor: displayColor }}
        aria-label={`Color: ${displayColor}`}
      />
      
      {/* Filament name (truncated) */}
      <span className="text-sm text-gray-200 truncate flex-1">
        {profile.name}
      </span>

      {/* Edit button */}
      <button
        onClick={onEdit}
        className="w-5 h-5 flex items-center justify-center rounded bg-gray-600 hover:bg-teal-600 text-white text-xs transition-colors flex-shrink-0"
        title="Edit filament settings"
        aria-label={`Edit ${profile.name}`}
      >
        ✎
      </button>
      
      {/* Remove button (minus icon) */}
      <button
        onClick={onRemove}
        className="w-5 h-5 flex items-center justify-center rounded bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors flex-shrink-0"
        title="Remove this filament"
        aria-label={`Remove ${profile.name}`}
      >
        −
      </button>
    </div>
  );
};

export const FilamentRow: React.FC = () => {
  const {
    filamentProfiles,
    selectedFilamentProfiles,
    selectedManufacturer,
    selectedPrinterProfile,
    printerSystemName,
    toggleFilamentProfile,
    saveUserConfig,
  } = useStore();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFilament, setEditingFilament] = useState<{ profile: { name: string; path: string }; index: number } | null>(null);

  // Auto-save when filament profiles change
  useEffect(() => {
    if (selectedFilamentProfiles.length > 0) {
      saveUserConfig().catch(err => {
        console.error('Failed to auto-save config:', err);
      });
    }
  }, [selectedFilamentProfiles, saveUserConfig]);

  const handleAddFilament = () => {
    if (filamentProfiles.length === 0) {
      // No profiles available
      return;
    }
    setIsModalOpen(true);
  };

  const handleRemoveFilament = (profile: { name: string; path: string }) => {
    toggleFilamentProfile(profile);
  };

  const canAddFilament = selectedManufacturer !== null && filamentProfiles.length > 0;

  return (
    <div className="space-y-1">
      {/* Header with title and add button */}
      <div className="flex justify-between items-center mb-1">
        <h3 className="text-sm font-semibold text-white">
          Filament
        </h3>
        <button
          onClick={handleAddFilament}
          disabled={!canAddFilament}
          className="w-6 h-6 flex items-center justify-center rounded bg-purple-600 text-white text-sm font-bold hover:bg-purple-700 disabled:bg-gray-600 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
          title={!canAddFilament ? 'Select a manufacturer first' : 'Add filament profile'}
          aria-label="Add filament"
        >
          +
        </button>
      </div>
      
      {/* Selected count */}
      <div className="text-xs text-gray-400 mb-1">
        {selectedFilamentProfiles.length} selected
      </div>

      {/* Selected Filament Swatches */}
      <div className="space-y-2 min-h-[40px]">
        {selectedFilamentProfiles.length === 0 ? (
          <div className="flex items-center justify-center h-16 border-2 border-dashed border-gray-600 rounded text-gray-500 text-sm">
            No filaments selected
          </div>
        ) : (
          selectedFilamentProfiles.map((profile, idx) => (
            <FilamentSwatch
              key={profile.path}
              profile={profile}
              onRemove={() => handleRemoveFilament(profile)}
              onEdit={() => setEditingFilament({ profile, index: idx })}
            />
          ))
        )}
      </div>

      {/* Filament Picker Modal with backend-provided filters */}
      <FilamentPickerModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        filamentProfiles={filamentProfiles}
        selectedPaths={selectedFilamentProfiles.map((p) => p.path)}
        onToggle={toggleFilamentProfile}
        selectedPrinterName={printerSystemName ?? selectedPrinterProfile?.name ?? null}
      />

      {/* Filament Config Edit Dialog */}
      <FilamentConfigDialog
        isOpen={editingFilament !== null}
        onClose={() => setEditingFilament(null)}
        profilePath={editingFilament?.profile.path ?? null}
        filamentName={editingFilament?.profile.name ?? ''}
        filamentIndex={editingFilament?.index ?? 0}
      />
    </div>
  );
};
