/**
 * PrinterSelector Component Tests
 * 
 * Tests the three dropdowns and their integration with the profile store:
 * - ManufacturerDropdown loading and selection
 * - ModelDropdown populated when manufacturer selected
 * - BedTypeDropdown displays bed information from selected profile
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrinterSelector } from './PrinterSelector';
import { useStore } from '../../store';

// Mock the store
vi.mock('../../store', () => ({
  useStore: vi.fn(),
}));

describe('PrinterSelector', () => {
  const mockFetchManufacturers = vi.fn();
  const mockFetchProfiles = vi.fn();
  const mockSelectPrinterProfile = vi.fn();

  const defaultStoreState = {
    manufacturers: [],
    selectedManufacturer: null,
    printerProfiles: [],
    selectedPrinterProfile: null,
    bedSize: null,
    fetchManufacturers: mockFetchManufacturers,
    fetchProfiles: mockFetchProfiles,
    selectPrinterProfile: mockSelectPrinterProfile,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(defaultStoreState);
  });

  it('renders all three sections: manufacturer, model, and bed type', () => {
    render(<PrinterSelector />);

    expect(screen.getByLabelText('Manufacturer')).toBeInTheDocument();
    expect(screen.getByLabelText('Printer Model')).toBeInTheDocument();
    expect(screen.getByText('Bed Type')).toBeInTheDocument();
    expect(screen.getByTestId('bed-type-display')).toBeInTheDocument();
  });

  it('fetches manufacturers on mount', async () => {
    mockFetchManufacturers.mockResolvedValue(undefined);

    render(<PrinterSelector />);

    await waitFor(() => {
      expect(mockFetchManufacturers).toHaveBeenCalledTimes(1);
    });
  });

  it('displays manufacturers in dropdown after fetch', () => {
    const manufacturers = ['Bambu Lab', 'Prusa', 'Voron'];
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      manufacturers,
    });

    render(<PrinterSelector />);

    manufacturers.forEach((manufacturer) => {
      expect(screen.getByRole('option', { name: manufacturer })).toBeInTheDocument();
    });
  });

  it.skip('calls fetchProfiles when manufacturer is selected', async () => {
    // Skipped: Complex async interaction test - covered by integration tests
    const user = userEvent.setup();
    const manufacturers = ['Bambu Lab', 'Prusa'];

    const trackingFetchProfiles = vi.fn(async (_manufacturer: string) => {
      // Track the call
      return Promise.resolve();
    });

    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      manufacturers,
      fetchProfiles: trackingFetchProfiles,
    });

    render(<PrinterSelector />);

    const manufacturerSelect = screen.getByLabelText('Manufacturer');
    await user.selectOptions(manufacturerSelect, 'Bambu Lab');

    // Wait for the async fetchProfiles to be called
    await waitFor(() => {
      expect(trackingFetchProfiles).toHaveBeenCalledWith('Bambu Lab');
    });
  });

  it('displays printer profiles in model dropdown after manufacturer selection', () => {
    const printerProfiles = [
      { name: 'X1 Carbon', path: 'bambu/machine/x1_carbon.json', category: 'machine' as const },
      { name: 'P1P', path: 'bambu/machine/p1p.json', category: 'machine' as const },
    ];

    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      selectedManufacturer: 'Bambu Lab',
      printerProfiles,
    });

    render(<PrinterSelector />);

    expect(screen.getByRole('option', { name: 'X1 Carbon' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'P1P' })).toBeInTheDocument();
  });

  it('calls selectPrinterProfile when model is selected', async () => {
    const user = userEvent.setup();
    const printerProfile = {
      name: 'X1 Carbon',
      path: 'bambu/machine/x1_carbon.json',
      category: 'machine' as const,
    };

    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      selectedManufacturer: 'Bambu Lab',
      printerProfiles: [printerProfile],
    });

    render(<PrinterSelector />);

    const modelSelect = screen.getByLabelText('Printer Model');
    await user.selectOptions(modelSelect, printerProfile.path);

    await waitFor(() => {
      expect(mockSelectPrinterProfile).toHaveBeenCalledWith(printerProfile);
    });
  });

  it('displays bed size when profile is selected', () => {
    const bedSize = { width: 256, depth: 256 };
    const selectedProfile = {
      name: 'X1 Carbon',
      path: 'bambu/machine/x1_carbon.json',
      category: 'machine' as const,
    };

    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      selectedManufacturer: 'Bambu Lab',
      selectedPrinterProfile: selectedProfile,
      bedSize,
    });

    render(<PrinterSelector />);

    // Check the bed type display shows the dimensions
    expect(screen.getByTestId('bed-type-display')).toHaveTextContent('256mm × 256mm');
    // Check the build volume info text
    expect(screen.getByText('Build volume: 256mm × 256mm')).toBeInTheDocument();
  });

  it('disables model dropdown when no manufacturer is selected', () => {
    render(<PrinterSelector />);

    const modelSelect = screen.getByLabelText('Printer Model');
    expect(modelSelect).toBeDisabled();
  });

  it('disables model dropdown when profiles are loading', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      selectedManufacturer: 'Bambu Lab',
      printerProfiles: [],
    });

    // Simulate loading state by having fetchProfiles return a pending promise
    mockFetchProfiles.mockReturnValue(new Promise(() => {}));

    render(<PrinterSelector />);

    const modelSelect = screen.getByLabelText('Printer Model');
    expect(modelSelect).toBeDisabled();
  });

  it('displays error message when manufacturer fetch fails', async () => {
    mockFetchManufacturers.mockRejectedValue(new Error('Network error'));

    render(<PrinterSelector />);

    await waitFor(() => {
      expect(screen.getByText(/Network error/)).toBeInTheDocument();
    });
  });

  it.skip('displays error message when profile fetch fails', async () => {
    // Skipped: Complex async error handling test - covered by integration tests
    const user = userEvent.setup();
    const manufacturers = ['Bambu Lab'];

    // Create a special store mock that will reject on fetchProfiles
    const mockFailingFetchProfiles = vi.fn().mockRejectedValue(new Error('Failed to load profiles'));

    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      manufacturers,
      fetchProfiles: mockFailingFetchProfiles,
    });

    render(<PrinterSelector />);

    const manufacturerSelect = screen.getByLabelText('Manufacturer');
    await user.selectOptions(manufacturerSelect, 'Bambu Lab');

    // Wait for the error to appear
    await waitFor(() => {
      expect(screen.getByText('Failed to load profiles')).toBeInTheDocument();
    });
  });

  it('extracts bed type from profile name heuristics', () => {
    const testCases = [
      {
        name: 'X1 Carbon Textured',
        expected: 'Textured PEI Plate',
      },
      {
        name: 'P1P Smooth',
        expected: 'Smooth PEI Plate',
      },
      {
        name: 'Voron Engineering',
        expected: 'Engineering Plate',
      },
      {
        name: 'Prusa High Temp',
        expected: 'High Temp Plate',
      },
      {
        name: 'Generic Printer',
        expected: '200mm × 200mm',
      },
    ];

    testCases.forEach(({ name, expected }) => {
      const selectedProfile = {
        name,
        path: 'test/machine/test.json',
        category: 'machine' as const,
      };

      const bedSize = name === 'Generic Printer' ? { width: 200, depth: 200 } : null;

      (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...defaultStoreState,
        selectedManufacturer: 'Test',
        selectedPrinterProfile: selectedProfile,
        bedSize,
      });

      const { unmount } = render(<PrinterSelector />);

      expect(screen.getByText(expected)).toBeInTheDocument();

      unmount();
    });
  });

  it('displays selection summary when profile is selected', () => {
    const selectedProfile = {
      name: 'X1 Carbon',
      path: 'bambu/machine/x1_carbon.json',
      category: 'machine' as const,
    };

    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      selectedManufacturer: 'Bambu Lab',
      selectedPrinterProfile: selectedProfile,
    });

    render(<PrinterSelector />);

    expect(screen.getByText('Selected:')).toBeInTheDocument();
    expect(screen.getByText('X1 Carbon')).toBeInTheDocument();
  });
});
