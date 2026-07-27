/**
 * ProcessSelector Component Tests
 *
 * Tests the process profile dropdown and Global Objects checkbox.
 * The component fetches user process configs from the API on mount;
 * apiClient is mocked to prevent real network calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProcessSelector } from './ProcessSelector';
import { useStore } from '../../store';

vi.mock('../../store', () => ({
  useStore: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  apiClient: {
    listProcessConfigs: vi.fn().mockResolvedValue([]),
  },
}));

const mockSelectProcessProfile = vi.fn();
const mockFetchCompatibleProcessProfiles = vi.fn().mockResolvedValue(undefined);
const mockSaveUserConfig = vi.fn().mockResolvedValue(undefined);

const mockSetProcessTarget = vi.fn();
const mockSetSelectedObjectId = vi.fn();

const defaultState = {
  processProfiles: [],
  selectedProcessProfile: null,
  selectedManufacturer: null,
  selectedPrinterProfile: null,
  printerSystemName: null,
  selectProcessProfile: mockSelectProcessProfile,
  fetchCompatibleProcessProfiles: mockFetchCompatibleProcessProfiles,
  saveUserConfig: mockSaveUserConfig,
  overrides: {},
  processTarget: 'global',
  setProcessTarget: mockSetProcessTarget,
  uploadedFiles: [],
  setSelectedObjectId: mockSetSelectedObjectId,
  objectValidationErrors: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  (useStore as any).mockReturnValue({ ...defaultState });
  // ProcessSelector's "Objects" toggle button reads useStore.getState()
  // directly (to pick the first plate object without re-rendering) —
  // see handleSwitchToObjectsMode in ProcessSelector.tsx.
  (useStore as any).getState = vi.fn(() => defaultState);
});

describe('ProcessSelector', () => {
  it('renders the process profile dropdown and the Global/Objects toggle', () => {
    render(<ProcessSelector />);
    expect(screen.getByLabelText('Process Profile')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Global' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Objects' })).toBeInTheDocument();
  });

  it('disables process dropdown when no manufacturer is selected', () => {
    render(<ProcessSelector />);
    expect(screen.getByLabelText('Process Profile')).toBeDisabled();
  });

  it('shows "No process profiles available" placeholder when no manufacturer selected', () => {
    render(<ProcessSelector />);
    expect(screen.getByText('No process profiles available')).toBeInTheDocument();
  });

  it('displays process profiles in dropdown when manufacturer selected', () => {
    const processProfiles = [
      { name: '0.2mm Standard', path: 'bambu/process/0.2mm_standard.json', category: 'process' as const },
      { name: '0.28mm Draft', path: 'bambu/process/0.28mm_draft.json', category: 'process' as const },
    ];
    (useStore as any).mockReturnValue({
      ...defaultState,
      selectedManufacturer: 'Bambu Lab',
      processProfiles,
    });
    render(<ProcessSelector />);
    expect(screen.getByRole('option', { name: '0.2mm Standard' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '0.28mm Draft' })).toBeInTheDocument();
  });

  it('calls selectProcessProfile when a profile is selected', async () => {
    const user = userEvent.setup();
    const processProfile = {
      name: '0.2mm Standard',
      path: 'bambu/process/0.2mm_standard.json',
      category: 'process' as const,
    };
    (useStore as any).mockReturnValue({
      ...defaultState,
      selectedManufacturer: 'Bambu Lab',
      processProfiles: [processProfile],
    });
    render(<ProcessSelector />);
    await user.selectOptions(screen.getByLabelText('Process Profile'), processProfile.path);
    await waitFor(() => {
      expect(mockSelectProcessProfile).toHaveBeenCalledWith(processProfile);
    });
  });

  it('enables the dropdown when manufacturer is selected and profiles exist', () => {
    const processProfiles = [
      { name: '0.2mm Standard', path: 'bambu/process/standard.json', category: 'process' as const },
    ];
    (useStore as any).mockReturnValue({
      ...defaultState,
      selectedManufacturer: 'Bambu Lab',
      processProfiles,
    });
    render(<ProcessSelector />);
    expect(screen.getByLabelText('Process Profile')).not.toBeDisabled();
  });

  it('shows "No compatible process profiles" placeholder when printer selected but no profiles', async () => {
    (useStore as any).mockReturnValue({
      ...defaultState,
      selectedManufacturer: 'Bambu Lab',
      selectedPrinterProfile: { name: 'X1', path: 'bambu/machine/x1.json', category: 'machine' as const },
      processProfiles: [],
    });
    render(<ProcessSelector />);
    // After the compatible-profiles fetch resolves, shows the no-profiles placeholder
    await waitFor(() => {
      expect(screen.getByText('No compatible process profiles')).toBeInTheDocument();
    });
  });

  it('does not show a "select a printer" hint (removed to save vertical space)', () => {
    (useStore as any).mockReturnValue({
      ...defaultState,
      selectedManufacturer: 'Bambu Lab',
    });
    render(<ProcessSelector />);
    expect(screen.queryByText('Select a printer to filter compatible profiles')).not.toBeInTheDocument();
  });

  it('shows the profile dropdown (not the objects list) while on the Global tab', () => {
    render(<ProcessSelector />);
    expect(screen.getByLabelText('Process Profile')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search plate, object and part.')).not.toBeInTheDocument();
  });

  it('switches to the per-object list and selects the first plate object when Objects is clicked', async () => {
    const user = userEvent.setup();
    const stateWithFiles = {
      ...defaultState,
      uploadedFiles: [
        { file_id: 'f1', filename: 'box.stl', size_bytes: 1, extension: 'stl', uploaded_at: '', source_file_id: 'f1', is_clone: false },
      ],
    };
    (useStore as any).mockReturnValue(stateWithFiles);
    (useStore as any).getState = vi.fn(() => stateWithFiles);

    render(<ProcessSelector />);
    await user.click(screen.getByRole('tab', { name: 'Objects' }));

    expect(mockSetProcessTarget).toHaveBeenCalledWith('f1');
    expect(mockSetSelectedObjectId).toHaveBeenCalledWith('f1');
  });

  it('renders the objects list (not the profile dropdown) when processTarget is not global', () => {
    (useStore as any).mockReturnValue({ ...defaultState, processTarget: 'f1' });
    render(<ProcessSelector />);
    expect(screen.queryByLabelText('Process Profile')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search plate, object and part.')).toBeInTheDocument();
  });
});
