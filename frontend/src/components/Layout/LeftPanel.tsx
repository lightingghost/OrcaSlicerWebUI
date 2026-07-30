/**
 * LeftPanel Component
 * 
 * Expanded width panel (480px) matching OrcaSlicer native UI containing:
 * - PrinterSelector (Compact single row: printer button + nozzle + plate type)
 * - FilamentRow (Filament selection with add/remove)
 * - ProcessSelector (Process profile selection)
 * - ParameterTabs (Quality | Strength | Speed | Support | Multimaterial | Others)
 * 
 * Validates: Requirements 2, 3, 13.1
 */

import React, { useState } from 'react';
import { Settings } from 'lucide-react';
import {
  PrinterSelector,
  FilamentRow,
  ProcessSelector,
  ParameterTabs,
  PrinterConfigDialog,
} from '../LeftPanel';
import { useStore } from '../../store';

export const LeftPanel: React.FC = () => {
  const { selectedPrinterProfile } = useStore();
  const [configDialogOpen, setConfigDialogOpen] = useState(false);

  return (
    <aside 
      className="w-[480px] min-h-0 bg-gray-800 border-r border-gray-700 overflow-hidden flex-shrink-0 flex flex-col"
      aria-label="Configuration panel"
    >
      <div className="p-4 space-y-3 flex-shrink-0">
        {/* Printer Section - compact header with edit button */}
        <section aria-labelledby="printer-heading">
          <div className="flex items-center justify-between mb-2">
            <h3 id="printer-heading" className="text-sm font-semibold text-white">
              Printer
            </h3>
            <button
              onClick={() => setConfigDialogOpen(true)}
              disabled={!selectedPrinterProfile}
              title={selectedPrinterProfile ? 'Edit printer configuration' : 'Select a printer first'}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-gray-400
                hover:text-white hover:bg-gray-700 transition-colors disabled:opacity-30
                disabled:cursor-not-allowed text-xs"
              aria-label="Edit printer configuration"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
          <PrinterSelector />
        </section>

        {/* Filament Section - compact header with add button */}
        <section aria-labelledby="filament-heading">
          <FilamentRow />
        </section>

        {/* Process Section - compact header */}
        <section aria-labelledby="process-heading">
          <h3 id="process-heading" className="text-sm font-semibold text-white mb-2">
            Process
          </h3>
          <ProcessSelector />
        </section>
      </div>

      {/* Parameter Configuration Section - fills remaining space and scrolls internally */}
      <section
        aria-labelledby="parameters-heading"
        className="flex-1 min-h-0 flex flex-col px-4 pb-4"
      >
        <ParameterTabs />
      </section>

      {/* Printer Config Dialog */}
      <PrinterConfigDialog
        isOpen={configDialogOpen}
        onClose={() => setConfigDialogOpen(false)}
        profilePath={selectedPrinterProfile?.path ?? null}
        profileManufacturer={selectedPrinterProfile?.manufacturer}
        profileFilename={selectedPrinterProfile?.filename}
        isUserConfig={selectedPrinterProfile?.is_user === true}
        printerName={selectedPrinterProfile?.name ?? ''}
      />
    </aside>
  );
};
