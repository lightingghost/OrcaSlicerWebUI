/**
 * PrinterSelector Component Tests
 *
 * The component renders a compact row:
 *   [Printer button (opens modal)] [Nozzle select] [Plate type select]
 *
 * Tests cover:
 * - Initial render state (printer button present, no nozzle/plate selects)
 * - Error display when fetchManufacturers rejects
 * - Printer button shows selected model name
 * - Modal opens on button click and closes on "Close"
 * - Printer selection via modal calls selectPrinterProfile
 * - Nozzle select appears when a profile is selected
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PrinterSelector } from './PrinterSelector';
import { useStore } from '../../store';
import { apiClient } from '../../api/client';

vi.mock('../../store', () => ({
  useStore: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  apiClient: {
    deletePrinterConfig: vi.fn().mockResolvedValue({ message: 'deleted' }),
  },
}));

const mockSelectPrinterProfile = vi.fn();
const mockFetchManufacturers = vi.fn().mockResolvedValue(undefined);
const mockFetchAllProfiles = vi.fn().mockResolvedValue(undefined);
const mockFetchUserPrinterConfigs = vi.fn().mockResolvedValue([]);
const mockSaveUserConfig = vi.fn().mockResolvedValue(undefined);
const mockSelectBedType = vi.fn();
const mockClearSelectedPrinterProfile = vi.fn();

const defaultState = {
  manufacturers: [],
  selectedManufacturer: null,
  printerProfiles: [],
  selectedPrinterProfile: null,
  availableBedTypes: [],
  selectedBedType: null,
  fetchManufacturers: mockFetchManufacturers,
  fetchAllProfiles: mockFetchAllProfiles,
  selectPrinterProfile: mockSelectPrinterProfile,
  selectBedType: mockSelectBedType,
  saveUserConfig: mockSaveUserConfig,
  userPrinterConfigs: [],
  fetchUserPrinterConfigs: mockFetchUserPrinterConfigs,
  printerVariant: null,
  clearSelectedPrinterProfile: mockClearSelectedPrinterProfile,
};

beforeEach(() => {
  vi.clearAllMocks();
  (useStore as any).mockReturnValue({ ...defaultState });
});

describe('PrinterSelector', () => {
  it('renders the printer button', () => {
    render(<PrinterSelector />);
    // Button title shows "Select Printer" when nothing is selected
    expect(screen.getByTitle('Select Printer')).toBeInTheDocument();
  });

  it('fetches manufacturers on mount', async () => {
    render(<PrinterSelector />);
    await waitFor(() => {
      expect(mockFetchManufacturers).toHaveBeenCalledTimes(1);
    });
  });

  it('shows error when fetchManufacturers rejects', async () => {
    mockFetchManufacturers.mockRejectedValueOnce(new Error('Network error'));
    render(<PrinterSelector />);
    await waitFor(() => {
      expect(screen.getByText(/Network error/)).toBeInTheDocument();
    });
  });

  it('shows selected printer model name in button', () => {
    (useStore as any).mockReturnValue({
      ...defaultState,
      selectedPrinterProfile: {
        name: 'X1 Carbon 0.4 nozzle',
        path: 'bambu/machine/x1_carbon.json',
        category: 'machine',
      },
    });
    render(<PrinterSelector />);
    // Button title is set to the model without nozzle suffix
    expect(screen.getByTitle('X1 Carbon')).toBeInTheDocument();
  });

  it('opens the printer picker modal on button click', async () => {
    (useStore as any).mockReturnValue({
      ...defaultState,
      manufacturers: ['Bambu Lab'],
      printerProfiles: [
        { name: 'X1 Carbon 0.4 nozzle', path: 'Bambu Lab/machine/x1.json', category: 'machine' },
      ],
    });
    render(<PrinterSelector />);

    // Wait for the manufacturers fetch to complete so the button is enabled
    await waitFor(() => {
      expect(screen.getByTitle('Select Printer')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTitle('Select Printer'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Select Printer' })).toBeInTheDocument();
    });
  });

  it('closes modal when Close button clicked', async () => {
    (useStore as any).mockReturnValue({
      ...defaultState,
      manufacturers: ['Bambu Lab'],
      printerProfiles: [],
    });
    render(<PrinterSelector />);

    await waitFor(() => {
      expect(screen.getByTitle('Select Printer')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTitle('Select Printer'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Select Printer' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Select Printer' })).not.toBeInTheDocument();
    });
  });

  it('calls selectPrinterProfile when a printer is chosen in the modal', async () => {
    const profile = { name: 'X1 Carbon 0.4 nozzle', path: 'Bambu Lab/machine/x1.json', category: 'machine' };
    (useStore as any).mockReturnValue({
      ...defaultState,
      manufacturers: ['Bambu Lab'],
      printerProfiles: [profile],
    });
    render(<PrinterSelector />);

    await waitFor(() => {
      expect(screen.getByTitle('Select Printer')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTitle('Select Printer'));

    await waitFor(() => {
      expect(screen.getByText('X1 Carbon')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('X1 Carbon').closest('button')!);

    expect(mockSelectPrinterProfile).toHaveBeenCalledWith(profile);
  });

  it('shows nozzle select when a profile is selected', () => {
    (useStore as any).mockReturnValue({
      ...defaultState,
      selectedPrinterProfile: {
        name: 'X1 Carbon 0.4 nozzle',
        path: 'Bambu Lab/machine/x1.json',
        category: 'machine',
      },
      printerVariant: '0.4',
      printerProfiles: [
        { name: 'X1 Carbon 0.4 nozzle', path: 'Bambu Lab/machine/x1.json', category: 'machine' },
        { name: 'X1 Carbon 0.6 nozzle', path: 'Bambu Lab/machine/x1_06.json', category: 'machine' },
      ],
    });
    render(<PrinterSelector />);
    expect(screen.getByTitle('Nozzle size')).toBeInTheDocument();
  });

  describe('deleting a saved printer config', () => {
    const savedConfig = { name: 'My Custom Printer', path: '/workspace/printer/My Custom Printer.json', autosave: false };

    async function openModalWithSavedConfig(extraState: Record<string, unknown> = {}) {
      (useStore as any).mockReturnValue({
        ...defaultState,
        manufacturers: ['Bambu Lab'],
        userPrinterConfigs: [savedConfig],
        ...extraState,
      });
      render(<PrinterSelector />);
      const openButton = screen.getByRole('button', { name: /🖨️/ });
      await waitFor(() => expect(openButton).not.toBeDisabled());
      fireEvent.click(openButton);
      await waitFor(() => expect(screen.getByLabelText('Delete My Custom Printer')).toBeInTheDocument());
    }

    it('shows a delete button next to each saved config', async () => {
      await openModalWithSavedConfig();
      expect(screen.getByLabelText('Delete My Custom Printer')).toBeInTheDocument();
    });

    it('deletes the config via the API when confirmed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await openModalWithSavedConfig();

      fireEvent.click(screen.getByLabelText('Delete My Custom Printer'));

      await waitFor(() => {
        expect(apiClient.deletePrinterConfig).toHaveBeenCalledWith('My Custom Printer');
      });
      expect(mockFetchUserPrinterConfigs).toHaveBeenCalled();
    });

    it('does not delete when the confirmation is cancelled', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      await openModalWithSavedConfig();

      fireEvent.click(screen.getByLabelText('Delete My Custom Printer'));

      expect(apiClient.deletePrinterConfig).not.toHaveBeenCalled();
    });

    it('clears the selection when the currently-selected config is deleted', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await openModalWithSavedConfig({
        selectedPrinterProfile: { name: 'My Custom Printer', path: savedConfig.path, category: 'machine', is_user: true },
      });

      fireEvent.click(screen.getByLabelText('Delete My Custom Printer'));

      await waitFor(() => {
        expect(mockClearSelectedPrinterProfile).toHaveBeenCalled();
      });
    });

    it('does not clear the selection when a different config is deleted', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await openModalWithSavedConfig({
        selectedPrinterProfile: { name: 'Other Printer', path: '/workspace/printer/Other Printer.json', category: 'machine', is_user: true },
      });

      fireEvent.click(screen.getByLabelText('Delete My Custom Printer'));

      await waitFor(() => {
        expect(apiClient.deletePrinterConfig).toHaveBeenCalled();
      });
      expect(mockClearSelectedPrinterProfile).not.toHaveBeenCalled();
    });

    it('clicking delete does not also trigger selecting the config', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await openModalWithSavedConfig();

      fireEvent.click(screen.getByLabelText('Delete My Custom Printer'));

      await waitFor(() => expect(apiClient.deletePrinterConfig).toHaveBeenCalled());
      expect(mockSelectPrinterProfile).not.toHaveBeenCalled();
    });
  });
});
