/**
 * Layout Component
 * 
 * The main application shell that composes:
 * - TopBar: TabNav, TransformToolbar, SliceButton, ExportButton
 * - LeftPanel: 480px fixed width with all configuration components
 * - MainArea: ViewportContainer (Prepare tab) or PreviewViewport (Preview
 *   tab) + JobPanel + JobStatusPanel
 * 
 * This is the root layout for the main slicer interface.
 * 
 * The active tab now lives in the Zustand store (`activeTab` /
 * `setActiveTab`, see previewSlice.ts) rather than local component state,
 * so job completion can switch to the Preview tab programmatically
 * (jobSlice's onCompleted/polling handlers do this directly) — matching
 * native OrcaSlicer, which jumps to its Preview tab automatically once
 * slicing finishes.
 * 
 * Validates: Requirements 13.1, 13.4
 */

import React from 'react';
import { TopBar } from './TopBar';
import { LeftPanel } from './LeftPanel';
import { MainArea } from './MainArea';
import { useStore } from '../../store';

export const Layout: React.FC = () => {
  const activeTab = useStore((state) => state.activeTab);
  const setActiveTab = useStore((state) => state.setActiveTab);

  return (
    <div className="h-screen max-h-screen bg-gray-900 text-white flex flex-col overflow-hidden">
      {/* TopBar - handles job submission internally via Zustand store */}
      <div className="flex-shrink-0">
        <TopBar
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>

      {/* Main content area with LeftPanel and MainArea */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* LeftPanel - 480px fixed width */}
        <LeftPanel />

        {/* MainArea - flex-1 to fill remaining space */}
        <MainArea />
      </div>
    </div>
  );
};

export default Layout;
