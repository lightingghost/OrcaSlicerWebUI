/**
 * ParameterTabs Component
 * 
 * Renders tabbed UI matching OrcaSlicer native UI:
 * Quality / Strength / Speed / Support / Multimaterial / Others tabs.
 * G-code section removed as it has no parameters in native UI.
 * Loads parameter descriptors via parameterSlice.fetchDescriptors on mount.
 * Renders ParameterPanel with descriptors filtered by the active tab's section.
 */

import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { ParameterPanel } from './ParameterPanel';

type TabSection = 'quality' | 'strength' | 'speed' | 'support' | 'multi_material' | 'other';

interface Tab {
  id: TabSection;
  label: string;
}

const TABS: Tab[] = [
  { id: 'quality', label: 'Quality' },
  { id: 'strength', label: 'Strength' },
  { id: 'speed', label: 'Speed' },
  { id: 'support', label: 'Support' },
  { id: 'multi_material', label: 'Multimaterial' },
  { id: 'other', label: 'Others' },
];

export const ParameterTabs: React.FC = () => {
  const { fetchDescriptors, parameterDescriptors } = useStore();
  const [activeTab, setActiveTab] = useState<TabSection>('quality');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load parameter descriptors on mount
  useEffect(() => {
    const loadDescriptors = async () => {
      // Skip if already loaded
      if (parameterDescriptors.length > 0) return;

      setIsLoading(true);
      setError(null);

      try {
        await fetchDescriptors();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load parameters');
        console.error('Failed to fetch parameter descriptors:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadDescriptors();
  }, [fetchDescriptors, parameterDescriptors.length]);

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden flex flex-col flex-1 min-h-0">
      {/* Error Display */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-red-900/50 border border-red-500 rounded text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="p-4 text-center">
          <p className="text-gray-400 text-sm">Loading parameters...</p>
        </div>
      )}

      {/* Tabs and Content */}
      {!isLoading && !error && (
        <>
          {/* Tab List - wrapped flex without horizontal scroll */}
          <div className="flex flex-wrap border-b border-gray-700 bg-gray-900 flex-shrink-0">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-2 text-xs font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'text-purple-400 border-b-2 border-purple-400 bg-gray-800'
                    : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <ParameterPanel section={activeTab} />
        </>
      )}
    </div>
  );
};
