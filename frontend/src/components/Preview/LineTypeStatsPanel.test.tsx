import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LineTypeStatsPanel } from './LineTypeStatsPanel';
import { useStore } from '../../store';
import { parseGcode } from '../../lib/gcodeParser';
import sampleGcode from '../../lib/__fixtures__/sample.gcode?raw';

vi.mock('../../store', () => ({
  useStore: vi.fn(),
}));

describe('LineTypeStatsPanel', () => {
  const mockUseStore = useStore as unknown as ReturnType<typeof vi.fn>;

  const mockToggleRoleVisibility = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const withState = (state: Record<string, unknown>) => {
    mockUseStore.mockImplementation((selector: (s: typeof state) => unknown) => selector(state));
  };

  it('shows a loading message while the gcode is being fetched', () => {
    withState({
      parsedGcode: null,
      isLoadingGcode: true,
      gcodeLoadError: null,
      hiddenRoles: new Set(),
      toggleRoleVisibility: mockToggleRoleVisibility,
    });
    render(<LineTypeStatsPanel />);
    expect(screen.getByText(/Loading gcode preview/)).toBeInTheDocument();
  });

  it('shows an error message when loading failed', () => {
    withState({
      parsedGcode: null,
      isLoadingGcode: false,
      gcodeLoadError: 'Failed to download gcode: 404',
      hiddenRoles: new Set(),
      toggleRoleVisibility: mockToggleRoleVisibility,
    });
    render(<LineTypeStatsPanel />);
    expect(screen.getByText(/Failed to load preview/)).toBeInTheDocument();
    expect(screen.getByText(/404/)).toBeInTheDocument();
  });

  it('shows a placeholder message before any slice has completed', () => {
    withState({
      parsedGcode: null,
      isLoadingGcode: false,
      gcodeLoadError: null,
      hiddenRoles: new Set(),
      toggleRoleVisibility: mockToggleRoleVisibility,
    });
    render(<LineTypeStatsPanel />);
    expect(screen.getByText(/Slice the plate to see line-type statistics/)).toBeInTheDocument();
  });

  it('renders a table row for every line type present in a real sliced gcode file', () => {
    const parsed = parseGcode(sampleGcode);
    withState({
      parsedGcode: parsed,
      isLoadingGcode: false,
      gcodeLoadError: null,
      hiddenRoles: new Set(['Travel']),
      toggleRoleVisibility: mockToggleRoleVisibility,
    });
    render(<LineTypeStatsPanel />);

    // From the real sample: Inner wall, Outer wall, Sparse infill,
    // Internal solid infill, Top surface, Gap infill all appear.
    expect(screen.getByText('Inner wall')).toBeInTheDocument();
    expect(screen.getByText('Outer wall')).toBeInTheDocument();
    expect(screen.getByText('Sparse infill')).toBeInTheDocument();
    expect(screen.getByText('Internal solid infill')).toBeInTheDocument();
    expect(screen.getByText('Top surface')).toBeInTheDocument();
    expect(screen.getByText('Gap infill')).toBeInTheDocument();
    // Travel is always shown as its own row, even though it's not a
    // ;TYPE: role.
    expect(screen.getByText('Travel')).toBeInTheDocument();
  });

  it('renders the Total estimation section with native-matching labels', () => {
    const parsed = parseGcode(sampleGcode);
    withState({
      parsedGcode: parsed,
      isLoadingGcode: false,
      gcodeLoadError: null,
      hiddenRoles: new Set(['Travel']),
      toggleRoleVisibility: mockToggleRoleVisibility,
    });
    render(<LineTypeStatsPanel />);

    expect(screen.getByText('Total estimation')).toBeInTheDocument();
    expect(screen.getByText('Total Filament:')).toBeInTheDocument();
    expect(screen.getByText('Model Filament:')).toBeInTheDocument();
    expect(screen.getByText('Cost:')).toBeInTheDocument();
    expect(screen.getByText('Prepare time:')).toBeInTheDocument();
    expect(screen.getByText('Model printing time:')).toBeInTheDocument();
    expect(screen.getByText('Total time:')).toBeInTheDocument();

    // From the real sample's footer comments: 27m 7s printing time. Both
    // "Model printing time" and "Total time" show this value (this app
    // has no separate total-vs-model breakdown for a single-plate slice),
    // so it appears twice.
    expect(screen.getAllByText('27m7s').length).toBeGreaterThanOrEqual(1);
  });
});
