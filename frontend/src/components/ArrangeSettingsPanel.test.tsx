import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArrangeSettingsPanel } from './ArrangeSettingsPanel';
import { useStore } from '../store';
import { DEFAULT_ARRANGE_SETTINGS } from '../store/arrangeSettingsSlice';

vi.mock('../store', () => ({
  useStore: vi.fn(),
}));

describe('ArrangeSettingsPanel', () => {
  const mockSetArrangeSetting = vi.fn();
  const mockResetArrangeSettings = vi.fn();
  const mockTriggerArrange = vi.fn();
  const mockSetArrangeSettingsOpen = vi.fn();

  const baseState = {
    arrangeSettings: { ...DEFAULT_ARRANGE_SETTINGS },
    setArrangeSetting: mockSetArrangeSetting,
    resetArrangeSettings: mockResetArrangeSettings,
    triggerArrange: mockTriggerArrange,
    setArrangeSettingsOpen: mockSetArrangeSettingsOpen,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) => selector(baseState)
    );
  });

  it('renders the Spacing field with "0 means auto spacing." hint', () => {
    render(<ArrangeSettingsPanel />);
    expect(screen.getByLabelText('Spacing')).toBeInTheDocument();
    expect(screen.getByText('0 means auto spacing.')).toBeInTheDocument();
  });

  it('renders all three checkboxes matching the native settings popup', () => {
    render(<ArrangeSettingsPanel />);
    expect(screen.getByText('Auto rotate for arrangement')).toBeInTheDocument();
    expect(screen.getByText('Allow multiple materials on same plate')).toBeInTheDocument();
    expect(screen.getByText('Align to Y axis')).toBeInTheDocument();
  });

  it('defaults match native (allow multi-materials checked, others unchecked)', () => {
    render(<ArrangeSettingsPanel />);
    const rotateCheckbox = screen.getByRole('checkbox', { name: 'Auto rotate for arrangement' });
    const multiMaterialCheckbox = screen.getByRole('checkbox', { name: 'Allow multiple materials on same plate' });
    const alignCheckbox = screen.getByRole('checkbox', { name: 'Align to Y axis' });

    expect(rotateCheckbox).not.toBeChecked();
    expect(multiMaterialCheckbox).toBeChecked();
    expect(alignCheckbox).not.toBeChecked();
  });

  it('renders Arrange and Reset buttons', () => {
    render(<ArrangeSettingsPanel />);
    expect(screen.getByRole('button', { name: 'Arrange' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
  });

  it('calls setArrangeSetting when the spacing number input changes', () => {
    render(<ArrangeSettingsPanel />);
    fireEvent.change(screen.getByLabelText('Spacing'), { target: { value: '5' } });
    expect(mockSetArrangeSetting).toHaveBeenCalledWith('spacing', 5);
  });

  it('calls setArrangeSetting when Auto rotate for arrangement is toggled', () => {
    render(<ArrangeSettingsPanel />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Auto rotate for arrangement' }));
    expect(mockSetArrangeSetting).toHaveBeenCalledWith('enableRotation', true);
  });

  it('disables Align to Y axis when Auto rotate for arrangement is enabled', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: typeof baseState) => unknown) =>
        selector({
          ...baseState,
          arrangeSettings: { ...DEFAULT_ARRANGE_SETTINGS, enableRotation: true },
        })
    );
    render(<ArrangeSettingsPanel />);
    expect(screen.getByRole('checkbox', { name: 'Align to Y axis' })).toBeDisabled();
  });

  it('triggers arrange and closes the popup when Arrange is clicked', () => {
    render(<ArrangeSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Arrange' }));
    expect(mockTriggerArrange).toHaveBeenCalledTimes(1);
    expect(mockSetArrangeSettingsOpen).toHaveBeenCalledWith(false);
  });

  it('resets settings without triggering an arrange when Reset is clicked', () => {
    render(<ArrangeSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(mockResetArrangeSettings).toHaveBeenCalledTimes(1);
    expect(mockTriggerArrange).not.toHaveBeenCalled();
  });
});
