/**
 * Tests for FilamentRow Component
 *
 * Validates:
 * - Empty state and count label
 * - FilamentSwatch renders for each selected profile
 * - Add button (aria-label "Add filament") enabled/disabled state
 * - Per-swatch remove button
 * - Color swatch default color
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FilamentRow } from './FilamentRow';
import { useStore } from '../../store';
import { apiClient } from '../../api/client';

vi.mock('../../store', () => ({
  useStore: vi.fn(),
}));

// The modal calls apiClient – mock it to prevent fetch errors in tests
vi.mock('../../api/client', () => ({
  apiClient: {
    getFilamentMetadata: vi.fn().mockResolvedValue({
      manufacturers: [],
      material_types: [],
      filaments: [],
    }),
    listFilamentConfigs: vi.fn().mockResolvedValue([]),
    deleteFilamentConfig: vi.fn().mockResolvedValue({ message: 'deleted' }),
  },
}));

const mockFilamentProfiles = [
  { name: 'Generic PLA', path: 'BBL/filament/generic_pla.json', category: 'filament' as const },
  { name: 'Generic ABS', path: 'BBL/filament/generic_abs.json', category: 'filament' as const },
  { name: 'Generic PETG', path: 'BBL/filament/generic_petg.json', category: 'filament' as const },
];

const mockRemoveSelectedFilamentProfileByPath = vi.fn();

const baseState = {
  filamentProfiles: mockFilamentProfiles,
  selectedFilamentProfiles: [],
  selectedManufacturer: 'BBL',
  selectedPrinterProfile: null,
  printerSystemName: null,
  toggleFilamentProfile: vi.fn(),
  saveUserConfig: vi.fn().mockResolvedValue(undefined),
  removeSelectedFilamentProfileByPath: mockRemoveSelectedFilamentProfileByPath,
};

beforeEach(() => {
  vi.clearAllMocks();
  (useStore as any).mockReturnValue({ ...baseState });
});

describe('FilamentRow', () => {
  it('shows "No filaments selected" when none are selected', () => {
    render(<FilamentRow />);
    expect(screen.getByText('No filaments selected')).toBeInTheDocument();
    expect(screen.getByText('0 selected')).toBeInTheDocument();
  });

  it('shows a swatch for each selected filament', () => {
    (useStore as any).mockReturnValue({
      ...baseState,
      selectedFilamentProfiles: [mockFilamentProfiles[0], mockFilamentProfiles[1]],
    });
    render(<FilamentRow />);
    expect(screen.getByText('Generic PLA')).toBeInTheDocument();
    expect(screen.getByText('Generic ABS')).toBeInTheDocument();
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('disables Add button when no manufacturer is selected', () => {
    (useStore as any).mockReturnValue({ ...baseState, selectedManufacturer: null });
    render(<FilamentRow />);
    const addBtn = screen.getByLabelText('Add filament');
    expect(addBtn).toBeDisabled();
  });

  it('disables Add button when no filament profiles are available', () => {
    (useStore as any).mockReturnValue({ ...baseState, filamentProfiles: [] });
    render(<FilamentRow />);
    const addBtn = screen.getByLabelText('Add filament');
    expect(addBtn).toBeDisabled();
  });

  it('enables Add button when manufacturer selected and profiles exist', () => {
    render(<FilamentRow />);
    const addBtn = screen.getByLabelText('Add filament');
    expect(addBtn).not.toBeDisabled();
  });

  it('opens modal when Add button is clicked', () => {
    render(<FilamentRow />);
    fireEvent.click(screen.getByLabelText('Add filament'));
    expect(screen.getByText('Select Filament Profiles')).toBeInTheDocument();
  });

  it('shows per-swatch remove button for selected filaments', () => {
    (useStore as any).mockReturnValue({
      ...baseState,
      selectedFilamentProfiles: [mockFilamentProfiles[0]],
    });
    render(<FilamentRow />);
    expect(screen.getByLabelText('Remove Generic PLA')).toBeInTheDocument();
  });

  it('calls toggleFilamentProfile when swatch remove is clicked', () => {
    const toggle = vi.fn();
    (useStore as any).mockReturnValue({
      ...baseState,
      selectedFilamentProfiles: [mockFilamentProfiles[0]],
      toggleFilamentProfile: toggle,
    });
    render(<FilamentRow />);
    fireEvent.click(screen.getByLabelText('Remove Generic PLA'));
    expect(toggle).toHaveBeenCalledWith(mockFilamentProfiles[0]);
  });

  it('renders color swatch with default gray when no colour specified', () => {
    (useStore as any).mockReturnValue({
      ...baseState,
      selectedFilamentProfiles: [mockFilamentProfiles[0]],
    });
    render(<FilamentRow />);
    // The aria-label is "Color: #8B8B8B" (default gray)
    const swatch = screen.getByLabelText(/Color:/);
    expect(swatch).toHaveStyle({ backgroundColor: '#8B8B8B' });
  });

  describe('deleting a saved filament config', () => {
    const savedFilament = { name: 'My Filament', path: '/workspace/filament/My Filament.json', autosave: false };

    async function openModalWithSavedFilament(extraState: Record<string, unknown> = {}) {
      (apiClient.listFilamentConfigs as ReturnType<typeof vi.fn>).mockResolvedValue([savedFilament]);
      (useStore as any).mockReturnValue({ ...baseState, ...extraState });
      render(<FilamentRow />);
      fireEvent.click(screen.getByLabelText('Add filament'));
      await waitFor(() => expect(screen.getByLabelText('Delete My Filament')).toBeInTheDocument());
    }

    it('shows a delete button next to each saved filament config', async () => {
      await openModalWithSavedFilament();
    });

    it('deletes the config via the API when confirmed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await openModalWithSavedFilament();

      fireEvent.click(screen.getByLabelText('Delete My Filament'));

      await waitFor(() => {
        expect(apiClient.deleteFilamentConfig).toHaveBeenCalledWith('My Filament');
      });
    });

    it('does not delete when the confirmation is cancelled', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      await openModalWithSavedFilament();

      fireEvent.click(screen.getByLabelText('Delete My Filament'));

      expect(apiClient.deleteFilamentConfig).not.toHaveBeenCalled();
    });

    it('removes it from the selected filaments when the currently-selected config is deleted', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await openModalWithSavedFilament({
        selectedFilamentProfiles: [{ name: 'My Filament', path: savedFilament.path, category: 'filament', is_user: true }],
      });

      fireEvent.click(screen.getByLabelText('Delete My Filament'));

      await waitFor(() => {
        expect(mockRemoveSelectedFilamentProfileByPath).toHaveBeenCalledWith(savedFilament.path);
      });
    });

    it('does not touch the selection when a different filament is deleted', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await openModalWithSavedFilament({
        selectedFilamentProfiles: [{ name: 'Other Filament', path: '/workspace/filament/Other Filament.json', category: 'filament', is_user: true }],
      });

      fireEvent.click(screen.getByLabelText('Delete My Filament'));

      await waitFor(() => expect(apiClient.deleteFilamentConfig).toHaveBeenCalled());
      expect(mockRemoveSelectedFilamentProfileByPath).not.toHaveBeenCalled();
    });
  });
});
