/**
 * Layout Component Tests
 *
 * Tests for the main application shell.
 * Layout renders TopBar (with activeTab + onTabChange), LeftPanel,
 * and MainArea. LeftPanel is hidden on the 'device' tab.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Layout } from './Layout';
import { useStore } from '../../store';

vi.mock('../../store', () => ({
  useStore: vi.fn(),
}));

vi.mock('./TopBar', () => ({
  TopBar: ({ activeTab, onTabChange }: any) => (
    <div data-testid="topbar">
      <span data-testid="active-tab">{activeTab}</span>
      <button onClick={() => onTabChange?.('preview')} data-testid="tab-switch">
        Switch Tab
      </button>
    </div>
  ),
}));

vi.mock('./LeftPanel', () => ({
  LeftPanel: () => <div data-testid="leftpanel">LeftPanel</div>,
}));

vi.mock('./MainArea', () => ({
  MainArea: () => <div data-testid="mainarea">MainArea</div>,
}));

const setMockState = (overrides: Record<string, unknown>) => {
  const state = {
    activeTab: 'prepare',
    setActiveTab: vi.fn(),
    ...overrides,
  };
  (useStore as any).mockImplementation((selector?: (s: typeof state) => unknown) =>
    typeof selector === 'function' ? selector(state) : state
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  setMockState({});
});

describe('Layout', () => {
  it('renders all major layout sections', () => {
    render(<Layout />);
    expect(screen.getByTestId('topbar')).toBeInTheDocument();
    expect(screen.getByTestId('leftpanel')).toBeInTheDocument();
    expect(screen.getByTestId('mainarea')).toBeInTheDocument();
  });

  it('passes the active tab to TopBar', () => {
    setMockState({ activeTab: 'preview' });
    render(<Layout />);
    expect(screen.getByTestId('active-tab')).toHaveTextContent('preview');
  });

  it('calls setActiveTab when TopBar requests a tab change', () => {
    const mockSetActiveTab = vi.fn();
    setMockState({ setActiveTab: mockSetActiveTab });
    render(<Layout />);
    fireEvent.click(screen.getByTestId('tab-switch'));
    expect(mockSetActiveTab).toHaveBeenCalledWith('preview');
  });

  it('applies correct layout structure', () => {
    const { container } = render(<Layout />);
    expect(container.querySelector('.flex.flex-col')).toBeInTheDocument();
    expect(container.querySelector('.flex.flex-1')).toBeInTheDocument();
  });

  it('hides LeftPanel on the Device tab', () => {
    setMockState({ activeTab: 'device' });
    render(<Layout />);
    expect(screen.queryByTestId('leftpanel')).not.toBeInTheDocument();
    expect(screen.getByTestId('mainarea')).toBeInTheDocument();
  });

  it('shows LeftPanel on the Prepare tab', () => {
    setMockState({ activeTab: 'prepare' });
    render(<Layout />);
    expect(screen.getByTestId('leftpanel')).toBeInTheDocument();
  });

  it('shows LeftPanel on the Preview tab', () => {
    setMockState({ activeTab: 'preview' });
    render(<Layout />);
    expect(screen.getByTestId('leftpanel')).toBeInTheDocument();
  });
});
