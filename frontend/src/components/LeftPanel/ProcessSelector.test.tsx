/**
 * ProcessSelector Component Tests
 * 
 * Tests the process profile dropdown and GlobalObjectsToggle checkbox:
 * - Process profile dropdown populated from profileSlice
 * - GlobalObjectsToggle checkbox state management
 * - Integration with profileSlice.selectProcessProfile
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProcessSelector } from './ProcessSelector';
import { useStore } from '../../store';

// Mock the store
vi.mock('../../store', () => ({
  useStore: vi.fn(),
}));

describe('ProcessSelector', () => {
  const mockSelectProcessProfile = vi.fn();

  const defaultStoreState = {
    processProfiles: [],
    selectedProcessProfile: null,
    selectedManufacturer: null,
    selectProcessProfile: mockSelectProcessProfile,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(defaultStoreState);
  });

  it('renders process profile dropdown and global objects toggle', () => {
    render(<ProcessSelector />);

    expect(screen.getByLabelText('Process Profile')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Enable Global Objects/i })).toBeInTheDocument();
  });

  it('disables process dropdown when no manufacturer is selected', () => {
    render(<ProcessSelector />);

    const processSelect = screen.getByLabelText('Process Profile');
    expect(processSelect).toBeDisabled();
  });

  it('displays process profiles in dropdown when manufacturer is selected', () => {
    const processProfiles = [
      { name: '0.2mm Standard', path: 'bambu/process/0.2mm_standard.json', category: 'process' as const },
      { name: '0.28mm Draft', path: 'bambu/process/0.28mm_draft.json', category: 'process' as const },
      { name: '0.12mm Fine', path: 'bambu/process/0.12mm_fine.json', category: 'process' as const },
    ];

    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      selectedManufacturer: 'Bambu Lab',
      processProfiles,
    });

    render(<ProcessSelector />);

    expect(screen.getByRole('option', { name: '0.2mm Standard' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '0.28mm Draft' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '0.12mm Fine' })).toBeInTheDocument();
  });

  it('calls selectProcessProfile when a profile is selected', async () => {
    const user = userEvent.setup();
    const processProfile = {
      name: '0.2mm Standard',
      path: 'bambu/process/0.2mm_standard.json',
      category: 'process' as const,
    };

    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      selectedManufacturer: 'Bambu Lab',
      processProfiles: [processProfile],
    });

    render(<ProcessSelector />);

    const processSelect = screen.getByLabelText('Process Profile');
    await user.selectOptions(processSelect, processProfile.path);

    await waitFor(() => {
      expect(mockSelectProcessProfile).toHaveBeenCalledWith(processProfile);
    });
  });

  it('toggles global objects checkbox', async () => {
    const user = userEvent.setup();

    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      selectedManufacturer: 'Bambu Lab',
    });

    render(<ProcessSelector />);

    const checkbox = screen.getByRole('checkbox', { name: /Enable Global Objects/i }) as HTMLInputElement;
    
    // Initially checked
    expect(checkbox).toBeChecked();

    // Click to uncheck
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();

    // Click to check again
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  it('displays selection summary when profile is selected', () => {
    const selectedProfile = {
      name: '0.2mm Standard',
      path: 'bambu/process/0.2mm_standard.json',
      category: 'process' as const,
    };

    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      selectedManufacturer: 'Bambu Lab',
      selectedProcessProfile: selectedProfile,
      processProfiles: [selectedProfile],
    });

    render(<ProcessSelector />);

    expect(screen.getByText('Selected:')).toBeInTheDocument();
    // Use getAllByText since the profile name appears both in dropdown and summary
    const profileNames = screen.getAllByText('0.2mm Standard');
    expect(profileNames.length).toBeGreaterThan(0);
    expect(screen.getByText('Global objects:')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
  });

  it('updates selection summary when global objects toggle changes', async () => {
    const user = userEvent.setup();
    const selectedProfile = {
      name: '0.2mm Standard',
      path: 'bambu/process/0.2mm_standard.json',
      category: 'process' as const,
    };

    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      selectedManufacturer: 'Bambu Lab',
      selectedProcessProfile: selectedProfile,
      processProfiles: [selectedProfile],
    });

    render(<ProcessSelector />);

    // Initially shows Enabled
    expect(screen.getByText('Enabled')).toBeInTheDocument();

    // Toggle off
    const checkbox = screen.getByRole('checkbox', { name: /Enable Global Objects/i });
    await user.click(checkbox);

    // Now shows Disabled
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('disables process dropdown when no profiles are available', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      selectedManufacturer: 'Bambu Lab',
      processProfiles: [],
    });

    render(<ProcessSelector />);

    const processSelect = screen.getByLabelText('Process Profile');
    expect(processSelect).toBeDisabled();
    expect(screen.getByText('No process profiles available')).toBeInTheDocument();
  });

  it('renders placeholder text correctly when no manufacturer selected', () => {
    render(<ProcessSelector />);

    expect(screen.getByText('No process profiles available')).toBeInTheDocument();
  });

  it('allows profile selection when manufacturer is selected and profiles exist', () => {
    const processProfiles = [
      { name: '0.2mm Standard', path: 'bambu/process/0.2mm_standard.json', category: 'process' as const },
    ];

    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      ...defaultStoreState,
      selectedManufacturer: 'Bambu Lab',
      processProfiles,
    });

    render(<ProcessSelector />);

    const processSelect = screen.getByLabelText('Process Profile');
    expect(processSelect).not.toBeDisabled();
  });

  it('displays help text for global objects toggle', () => {
    render(<ProcessSelector />);

    expect(
      screen.getByText('Apply process settings globally to all objects on the plate')
    ).toBeInTheDocument();
  });
});
