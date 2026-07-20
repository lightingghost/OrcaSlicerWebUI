/**
 * Layout Component
 * 
 * The main application shell that composes:
 * - TopBar: TabNav, TransformToolbar, SliceButton, ExportButton
 * - LeftPanel: 480px fixed width with all configuration components
 * - MainArea: ViewportContainer + JobPanel + JobStatusPanel
 * 
 * This is the root layout for the main slicer interface.
 * 
 * Validates: Requirements 13.1, 13.4
 */

import React, { useState } from 'react';
import { TopBar } from './TopBar';
import { LeftPanel } from './LeftPanel';
import { MainArea } from './MainArea';

type Tab = 'prepare' | 'preview' | 'device' | 'project' | 'calibration';

export const Layout: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('prepare');

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
