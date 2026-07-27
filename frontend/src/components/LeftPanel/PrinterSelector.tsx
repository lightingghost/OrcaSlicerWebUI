/**
 * PrinterSelector Component
 * 
 * Compact printer configuration matching OrcaSlicer native UI:
 * - All three elements on same row: Printer button, Nozzle size, Plate type
 * - Printer button opens modal dialog for manufacturer + model selection
 * - Printer name shows last 15 characters, plate type shows first 20 characters
 * - Nozzle size extracted from printer profile name and shown separately
 * 
 * All selections are wired to profileSlice for global state management.
 */

import { useEffect, useState, useMemo } from 'react';
import { useStore } from '../../store';
import { ChevronDown } from 'lucide-react';
import type { PrinterConfigEntry } from '../../api/client';

/**
 * Extract base model name and nozzle size from printer profile name
 * Example: "Flashforge Adventurer 5M 0.4 nozzle" -> { model: "Flashforge Adventurer 5M", nozzle: "0.4" }
 */
function parsePrinterName(name: string): { model: string; nozzle: string | null } {
  // Match patterns like "0.4 nozzle", "0.4mm nozzle", "0.4mm", "0.4"
  const nozzleMatch = name.match(/(\d+\.?\d*)\s*(?:mm)?\s*(?:nozzle)?$/i);
  
  if (nozzleMatch) {
    const nozzle = nozzleMatch[1];
    const model = name.substring(0, nozzleMatch.index).trim();
    return { model, nozzle };
  }
  
  return { model: name, nozzle: null };
}

interface PrinterPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  manufacturers: string[];
  printerProfiles: Array<{ name: string; path: string; category: string }>;
  userPrinterConfigs: PrinterConfigEntry[];
  selectedPath: string | null;
  onSelect: (profile: any) => void;
}

const PrinterPickerModal: React.FC<PrinterPickerModalProps> = ({
  isOpen,
  onClose,
  manufacturers,
  printerProfiles,
  userPrinterConfigs,
  selectedPath,
  onSelect,
}) => {
  // Initialize filter based on currently selected printer's manufacturer
  const initialManufacturer = useMemo(() => {
    if (selectedPath) {
      const manufacturerMatch = selectedPath.match(/^([^/]+)\//);
      if (manufacturerMatch) {
        return manufacturerMatch[1];
      }
    }
    return 'all';
  }, [selectedPath, isOpen]); // Re-compute when modal opens

  const [filterManufacturer, setFilterManufacturer] = useState<string>(initialManufacturer);

  // Reset filter to selected printer's manufacturer when modal opens
  useEffect(() => {
    if (isOpen) {
      setFilterManufacturer(initialManufacturer);
    }
  }, [isOpen, initialManufacturer]);

  if (!isOpen) return null;

  // Filter printers by manufacturer (case-insensitive)
  const filteredPrinters = printerProfiles.filter(profile => {
    if (filterManufacturer === 'all') return true;
    // Extract manufacturer from path (e.g., "Flashforge/machine/..." -> "Flashforge")
    const profileManufacturer = profile.path.split('/')[0];
    return profileManufacturer.toLowerCase() === filterManufacturer.toLowerCase();
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
      <div className="bg-gray-800 rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        <h2 className="text-xl font-semibold text-white mb-4">Select Printer</h2>

        {/* Manufacturer Filter */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Filter by Manufacturer
          </label>
          <select
            value={filterManufacturer}
            onChange={(e) => setFilterManufacturer(e.target.value)}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="all">All Manufacturers</option>
            {manufacturers.map(manufacturer => (
              <option key={manufacturer} value={manufacturer}>
                {manufacturer}
              </option>
            ))}
          </select>
        </div>

        {/* Printer List */}
        <div className="flex-1 overflow-y-auto space-y-2 mb-4">
          {filteredPrinters.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">
              No printers match your filter
            </p>
          ) : (
            filteredPrinters.map((profile) => {
              const isSelected = selectedPath === profile.path;
              const { model, nozzle } = parsePrinterName(profile.name);
              
              return (
                <button
                  key={profile.path}
                  onClick={() => {
                    onSelect(profile);
                    onClose();
                  }}
                  className={`w-full p-3 rounded text-left transition-colors ${
                    isSelected
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium block truncate">
                        {model}
                      </span>
                      {nozzle && (
                        <span className="text-xs text-gray-400 block mt-1">
                          Nozzle: {nozzle}mm
                        </span>
                      )}
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

        {/* User-saved printer configs */}
        {userPrinterConfigs.filter(c => !c.autosave).length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                My saved configs
              </span>
              <div className="flex-1 h-px bg-gray-700" />
            </div>
            <div className="space-y-2">
              {userPrinterConfigs
                .filter(c => !c.autosave)
                .map(cfg => {
                  const isSelected = selectedPath === `user:${cfg.path}`;
                  return (
                    <button
                      key={cfg.path}
                      onClick={() => {
                        onSelect({ name: cfg.name, path: `user:${cfg.path}`, category: 'machine', isUserConfig: true });
                        onClose();
                      }}
                      className={`w-full p-3 rounded text-left transition-colors ${
                        isSelected
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-700/80 text-gray-200 hover:bg-gray-600 border border-dashed border-gray-600'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate">{cfg.name}</span>
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
          className="w-full px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
};

export const PrinterSelector: React.FC = () => {
  const {
    manufacturers,
    selectedManufacturer,
    printerProfiles,
    selectedPrinterProfile,
    availableBedTypes,
    selectedBedType,
    fetchManufacturers,
    fetchAllProfiles,
    selectPrinterProfile,
    selectBedType,
    userPrinterConfigs,
    fetchUserPrinterConfigs,
    printerVariant,
  } = useStore();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoadingManufacturers, setIsLoadingManufacturers] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch manufacturers on mount
  useEffect(() => {
    const loadManufacturers = async () => {
      setIsLoadingManufacturers(true);
      setError(null);
      try {
        await fetchManufacturers();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load manufacturers');
      } finally {
        setIsLoadingManufacturers(false);
      }
    };

    loadManufacturers();
  }, [fetchManufacturers]);

  // Load all profiles when modal opens (single request)
  // Always load if we don't have profiles from all manufacturers
  useEffect(() => {
    const loadAllProfiles = async () => {
      if (isModalOpen && manufacturers.length > 0) {
        // Check if we need to load profiles
        // We should have profiles from multiple manufacturers
        const uniqueManufacturers = new Set(
          printerProfiles.map(p => p.path.split('/')[0])
        );
        
        // If we have very few profiles or only one manufacturer, reload all
        if (printerProfiles.length === 0 || uniqueManufacturers.size < manufacturers.length) {
          try {
            await fetchAllProfiles();
          } catch (err) {
            console.error('Failed to load all profiles:', err);
            setError(err instanceof Error ? err.message : 'Failed to load profiles');
          }
        }
      }
    };

    loadAllProfiles();
  }, [isModalOpen, manufacturers.length]);

  // Load user printer configs when modal opens
  useEffect(() => {
    if (isModalOpen) {
      fetchUserPrinterConfigs().catch(err => {
        console.error('Failed to load user printer configs:', err);
      });
    }
  }, [isModalOpen, fetchUserPrinterConfigs]);

  // Note: auto-save on printer/bed-type change is handled centrally by
  // ConfigAutoSave.tsx (debounced), avoiding duplicate saveUserConfig() calls.

  // Parse selected printer info — model name only (nozzle comes from printerVariant)
  const selectedPrinterInfo = useMemo(() => {
    if (!selectedPrinterProfile) return null;
    // Strip any trailing nozzle-size suffix from the display name for the button
    const { model } = parsePrinterName(selectedPrinterProfile.name);
    return { model };
  }, [selectedPrinterProfile]);

  // Get unique nozzle sizes for selected printer model from profiles list
  const availableNozzles = useMemo(() => {
    if (!selectedPrinterProfile) return [];
    const { model } = parsePrinterName(selectedPrinterProfile.name);
    const nozzles = printerProfiles
      .map(p => parsePrinterName(p.name))
      .filter(p => p.model === model && p.nozzle)
      .map(p => p.nozzle!)
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => parseFloat(a) - parseFloat(b));
    return nozzles;
  }, [printerProfiles, selectedPrinterProfile]);

  const handleNozzleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nozzleSize = e.target.value;
    if (!nozzleSize || !selectedPrinterInfo) return;

    // Find the printer profile with this model and nozzle size
    const targetName = `${selectedPrinterInfo.model} ${nozzleSize}`;
    const profile = printerProfiles.find(p => p.name.includes(targetName));
    
    if (profile) {
      selectPrinterProfile(profile);
    }
  };

  const handleBedTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const bedType = e.target.value;
    if (!bedType) return;
    selectBedType(bedType);
  };

  const handleOpenModal = () => {
    if (isLoadingManufacturers) return;
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-2">
      {/* Error Display */}
      {error && (
        <div className="p-2 bg-red-900/50 border border-red-500 rounded text-red-200 text-xs">
          {error}
        </div>
      )}

      {/* Single row: Printer button, Nozzle, Plate Type */}
      <div className="grid grid-cols-[3fr_0.7fr_2fr] gap-2">
        {/* Printer button (opens modal) */}
        <div>
          <button
            onClick={handleOpenModal}
            disabled={isLoadingManufacturers}
            className="w-full flex items-center justify-between px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed h-[38px]"
            title={selectedPrinterInfo ? selectedPrinterInfo.model : 'Select Printer'}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-base">🖨️</span>
              <span className="text-sm truncate">
                {selectedPrinterInfo ? selectedPrinterInfo.model.slice(-20) : 'Select'}
              </span>
            </div>
            <ChevronDown className="w-4 h-4 flex-shrink-0" />
          </button>
        </div>

        {/* Nozzle Size — value from resolved printer_variant, not name parsing */}
        {selectedPrinterProfile && (
          <div>
            <select
              id="nozzle"
              value={printerVariant || ''}
              onChange={handleNozzleChange}
              disabled={availableNozzles.length <= 1}
              className="w-full px-2 py-2 text-sm bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 h-[38px]"
              title="Nozzle size"
            >
              {availableNozzles.length === 0 ? (
                <option value={printerVariant || ''}>{printerVariant || 'N/A'}</option>
              ) : (
                availableNozzles.map(nozzle => (
                  <option key={nozzle} value={nozzle}>
                    {nozzle}
                  </option>
                ))
              )}
            </select>
          </div>
        )}

        {/* Plate Type */}
        {selectedPrinterProfile && (
          <div>
            <select
              id="bedType"
              value={selectedBedType || ''}
              onChange={handleBedTypeChange}
              className="w-full px-2 py-2 text-sm bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-purple-500 h-[38px]"
              title="Plate type"
            >
              <option value="">Select plate</option>
              {availableBedTypes.map((bedType) => (
                <option key={bedType} value={bedType}>
                  {bedType.slice(0, 20)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Printer Picker Modal */}
      <PrinterPickerModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        manufacturers={manufacturers}
        printerProfiles={printerProfiles}
        userPrinterConfigs={userPrinterConfigs}
        selectedPath={selectedPrinterProfile?.path || null}
        onSelect={selectPrinterProfile}
      />
    </div>
  );
};
