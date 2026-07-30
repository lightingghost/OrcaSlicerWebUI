/**
 * ProcessSelector Component Tests
 *
 * The component renders a compact row:
 *   [Process profile button (opens modal)] [Save button]
 * (plus the Global/Objects toggle above it). The picker button opens a
 * modal listing system profiles and user-saved configs (each with its
 * own delete button, visible while just browsing — see
 * ProcessPickerModal in ProcessSelector.tsx for why a custom modal is
 * used instead of a native <select>).
 *
 * The component fetches user process configs from the API on mount;
 * apiClient is mocked to prevent real network calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProcessSelector } from './ProcessSelector';
import { useStore } from '../../store';
import { apiClient } from '../../api/client';

vi.mock('../../store', () => ({
  useStore: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  apiClient: {
    listProcessConfigs: vi.fn().mockResolvedValue([]),
    deleteProcessConfig: vi.fn().mockResolvedValue({ message: 'deleted' }),
  },
}));

const mockSelectProcessProfile = vi.fn();
const mockClearSelectedProcessProfile = vi.fn();
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
  clearSelectedProcessProfile: mockClearSelectedProcessProfile,
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
  it('renders the process profile picker button and the Global/Objects toggle', () => {
    render(<ProcessSelector />);
    expect(screen.getByLabelText('Process Profile')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Global' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Objects' })).toBeInTheDocument();
  });

  it('disables the picker button when no manufacturer is selected', () => {
    render(<ProcessSelector />);
    expect(screen.getByLabelText('Process Profile')).toBeDisabled();
  });

  it('shows "No process profiles available" placeholder when no manufacturer selected', () => {
    render(<ProcessSelector />);
    expect(screen.getByText('No process profiles available')).toBeInTheDocument();
  });

  it('opens the picker modal listing system process profiles when manufacturer selected', async () => {
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
    fireEvent.click(screen.getByLabelText('Process Profile'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Select Process Profile' })).toBeInTheDocument();
    });
    expect(screen.getByText('0.2mm Standard')).toBeInTheDocument();
    expect(screen.getByText('0.28mm Draft')).toBeInTheDocument();
  });

  it('calls selectProcessProfile when a system profile is chosen in the modal', async () => {
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
    fireEvent.click(screen.getByLabelText('Process Profile'));

    await waitFor(() => expect(screen.getByText('0.2mm Standard')).toBeInTheDocument());
    fireEvent.click(screen.getByText('0.2mm Standard').closest('button')!);

    await waitFor(() => {
      expect(mockSelectProcessProfile).toHaveBeenCalledWith(processProfile);
    });
  });

  it('enables the picker button when manufacturer is selected and profiles exist', () => {
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

  it('shows the profile picker (not the objects list) while on the Global tab', () => {
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

  it('renders the objects list (not the profile picker) when processTarget is not global', () => {
    (useStore as any).mockReturnValue({ ...defaultState, processTarget: 'f1' });
    render(<ProcessSelector />);
    expect(screen.queryByLabelText('Process Profile')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search plate, object and part.')).toBeInTheDocument();
  });

  describe('deleting a saved process config while browsing the picker', () => {
    const compatibleSystemProfile = {
      name: '0.2mm Standard',
      path: 'bambu/process/0.2mm_standard.json',
      category: 'process' as const,
    };
    const savedConfig = { name: 'My Process', path: '/workspace/process/My Process.json', autosave: false, inherits: '0.2mm Standard' };

    async function openModalWithSavedConfig(extraState: Record<string, unknown> = {}) {
      (apiClient.listProcessConfigs as ReturnType<typeof vi.fn>).mockResolvedValue([savedConfig]);
      (useStore as any).mockReturnValue({
        ...defaultState,
        selectedManufacturer: 'Bambu Lab',
        selectedPrinterProfile: { name: 'X1', path: 'bambu/machine/x1.json', category: 'machine' as const },
        processProfiles: [compatibleSystemProfile],
        ...extraState,
      });
      render(<ProcessSelector />);
      await waitFor(() => expect(screen.getByLabelText('Process Profile')).not.toBeDisabled());
      fireEvent.click(screen.getByLabelText('Process Profile'));
      await waitFor(() => expect(screen.getByLabelText('Delete My Process')).toBeInTheDocument());
    }

    it('shows a delete button next to a saved config while just browsing (not yet selected)', async () => {
      await openModalWithSavedConfig();
      expect(screen.getByLabelText('Delete My Process')).toBeInTheDocument();
    });

    it('deletes the config via the API when confirmed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await openModalWithSavedConfig();

      fireEvent.click(screen.getByLabelText('Delete My Process'));

      await waitFor(() => {
        expect(apiClient.deleteProcessConfig).toHaveBeenCalledWith('My Process');
      });
    });

    it('does not delete when the confirmation is cancelled', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      await openModalWithSavedConfig();

      fireEvent.click(screen.getByLabelText('Delete My Process'));

      expect(apiClient.deleteProcessConfig).not.toHaveBeenCalled();
    });

    it('clears the selection when the currently-selected config is deleted', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await openModalWithSavedConfig({
        selectedProcessProfile: { name: 'My Process', path: savedConfig.path, category: 'process', is_user: true },
      });

      fireEvent.click(screen.getByLabelText('Delete My Process'));

      await waitFor(() => {
        expect(mockClearSelectedProcessProfile).toHaveBeenCalled();
      });
    });

    it('does not clear the selection when a different config is deleted', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await openModalWithSavedConfig({
        selectedProcessProfile: { name: 'Other Process', path: '/workspace/process/Other Process.json', category: 'process', is_user: true },
      });

      fireEvent.click(screen.getByLabelText('Delete My Process'));

      await waitFor(() => expect(apiClient.deleteProcessConfig).toHaveBeenCalled());
      expect(mockClearSelectedProcessProfile).not.toHaveBeenCalled();
    });

    it('clicking delete does not also trigger selecting the config', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await openModalWithSavedConfig();

      fireEvent.click(screen.getByLabelText('Delete My Process'));

      await waitFor(() => expect(apiClient.deleteProcessConfig).toHaveBeenCalled());
      expect(mockSelectProcessProfile).not.toHaveBeenCalled();
    });
  });

  describe('filtering saved process configs by printer compatibility', () => {
    const compatibleSystemProfile = {
      name: '0.2mm Standard',
      path: 'bambu/process/0.2mm_standard.json',
      category: 'process' as const,
    };
    const compatibleSavedConfig = { name: 'My Compatible Config', path: '/workspace/process/compatible.json', autosave: false, inherits: '0.2mm Standard' };
    const incompatibleSavedConfig = { name: 'My Incompatible Config', path: '/workspace/process/incompatible.json', autosave: false, inherits: 'Some Other Printer Process' };
    const noInheritsSavedConfig = { name: 'Orphan Config', path: '/workspace/process/orphan.json', autosave: false, inherits: null };

    it('only shows saved configs whose `inherits` matches a compatible system profile', async () => {
      (apiClient.listProcessConfigs as ReturnType<typeof vi.fn>).mockResolvedValue([
        compatibleSavedConfig,
        incompatibleSavedConfig,
        noInheritsSavedConfig,
      ]);
      (useStore as any).mockReturnValue({
        ...defaultState,
        selectedManufacturer: 'Bambu Lab',
        selectedPrinterProfile: { name: 'X1', path: 'bambu/machine/x1.json', category: 'machine' as const },
        processProfiles: [compatibleSystemProfile],
      });

      render(<ProcessSelector />);
      await waitFor(() => expect(apiClient.listProcessConfigs).toHaveBeenCalled());
      fireEvent.click(screen.getByLabelText('Process Profile'));

      await waitFor(() => {
        expect(screen.getByText('My Compatible Config')).toBeInTheDocument();
      });
      expect(screen.queryByText('My Incompatible Config')).not.toBeInTheDocument();
      expect(screen.queryByText('Orphan Config')).not.toBeInTheDocument();
    });

    it('shows no saved configs at all when no printer is selected', async () => {
      (apiClient.listProcessConfigs as ReturnType<typeof vi.fn>).mockResolvedValue([compatibleSavedConfig]);
      (useStore as any).mockReturnValue({
        ...defaultState,
        selectedManufacturer: 'Bambu Lab',
        processProfiles: [],
      });

      render(<ProcessSelector />);

      await waitFor(() => {
        expect(apiClient.listProcessConfigs).toHaveBeenCalled();
      });
      expect(screen.queryByText('My Compatible Config')).not.toBeInTheDocument();
    });
  });
});
