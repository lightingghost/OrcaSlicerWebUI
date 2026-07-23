import React from 'react';
import { X } from 'lucide-react';
import { ActionSelector } from './ActionSelector';
import { TransformPanel } from './TransformPanel';
import { AdvancedPanel } from './AdvancedPanel';
import { SubmitButton } from './SubmitButton';

/**
 * JobOptionsModal Component
 *
 * The native OrcaSlicer desktop UI has no persistent "Action / Advanced
 * Options" panel docked under the 3D viewport — slicing is triggered
 * directly from the Slice/Export buttons in the top bar, and CLI-style
 * options (this web UI's Action, Transform, and Advanced/misc panels have
 * no native equivalent since they map to `orca-slicer` CLI flags rather
 * than desktop UI controls) are opened on demand.
 *
 * This modal houses those CLI-specific controls (ActionSelector,
 * TransformPanel, AdvancedPanel, SubmitButton) so they no longer occupy
 * permanent space in the main viewport area. It's opened via a toolbar
 * button (see TopBar) and can be closed without losing any selections,
 * since all state lives in the Zustand store, not local component state.
 */
interface JobOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const JobOptionsModal: React.FC<JobOptionsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-900 rounded-lg shadow-2xl border border-gray-700 w-full max-w-4xl max-h-[85vh] mx-6 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 flex-shrink-0">
          <h2 className="text-lg font-semibold text-white">Job Options</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Close job options"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body - scrollable */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-4">
              <ActionSelector />
              <TransformPanel />
            </div>
            <div>
              <AdvancedPanel />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-gray-700 flex-shrink-0">
          <SubmitButton />
        </div>
      </div>
    </div>
  );
};
