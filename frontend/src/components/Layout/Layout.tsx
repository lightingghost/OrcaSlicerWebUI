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

import React, { useEffect, useState } from 'react';
import { TopBar } from './TopBar';
import { LeftPanel } from './LeftPanel';
import { MainArea } from './MainArea';
import { useStore } from '../../store';

// Phone layout: below this width the settings panel and the
// 3D view each get the full screen, switched by a bottom tab bar.
const MOBILE_MAX_WIDTH = 900;

function useIsMobile(): boolean {
  const query = `(max-width: ${MOBILE_MAX_WIDTH}px)`;
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return isMobile;
}

export const Layout: React.FC = () => {
  const activeTab = useStore((state) => state.activeTab);
  const setActiveTab = useStore((state) => state.setActiveTab);
  const isMobile = useIsMobile();
  const [mobilePane, setMobilePane] = useState<'settings' | 'view'>('view');

  // Slicing finishing switches activeTab to Preview; show the 3D view then.
  useEffect(() => {
    if (activeTab !== 'prepare') setMobilePane('view');
  }, [activeTab]);

  if (isMobile) {
    const showSettings = mobilePane === 'settings' && activeTab !== 'device';
    // Inactive pane uses `invisible` rather than unmounting so the WebGL
    // canvas keeps its size and scene state.
    const pane = (visible: boolean) =>
      `absolute inset-0 flex ${visible ? '' : 'invisible pointer-events-none'}`;
    return (
      <div className="h-[100dvh] max-h-[100dvh] bg-gray-900 text-white flex flex-col overflow-hidden">
        <div className="flex-shrink-0">
          <TopBar activeTab={activeTab} onTabChange={setActiveTab} compact />
        </div>
        <div className="flex-1 min-h-0 relative overflow-hidden">
          <div className={pane(!showSettings)}>
            <MainArea />
          </div>
          {activeTab !== 'device' && (
            <div className={pane(showSettings)}>
              <LeftPanel fullWidth />
            </div>
          )}
        </div>
        {activeTab !== 'device' && (
          <nav className="flex-shrink-0 grid grid-cols-2 border-t border-gray-700 bg-gray-800" aria-label="Mobile panes">
            {(['settings', 'view'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setMobilePane(p)}
                className={`py-4 text-base font-semibold ${
                  mobilePane === p ? 'text-white bg-purple-600' : 'text-gray-300'
                }`}
              >
                {p === 'settings' ? 'Settings' : '3D View'}
              </button>
            ))}
          </nav>
        )}
      </div>
    );
  }

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
        {/* LeftPanel - 480px fixed width. Hidden on the Device tab: the
            printer/filament/process profile settings it holds are
            slicing-specific and have no bearing on connecting to /
            viewing a physical printer's own UI, matching native
            OrcaSlicer's Device tab, which also has no such sidebar. */}
        {activeTab !== 'device' && <LeftPanel />}

        {/* MainArea - flex-1 to fill remaining space */}
        <MainArea />
      </div>
    </div>
  );
};

export default Layout;
