import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionSelector } from './ActionSelector';

/**
 * Unit tests for ActionSelector component
 * 
 * Task: 16.5 Write unit tests for ActionSelector
 * Requirements: 5.1, 5.2, 5.3, 5.4
 * 
 * Tests verify:
 * - Correct action flag conditional UI (plate selector, output filename input)
 * - Each radio option renders correctly
 */

describe('ActionSelector', () => {
  describe('Radio Options Rendering (Requirement 5.1)', () => {
    it('renders all five action radio buttons', () => {
      render(<ActionSelector />);
      
      // Verify all 5 radio options are present
      expect(screen.getByLabelText('Slice')).toBeInTheDocument();
      expect(screen.getByLabelText('Export 3MF')).toBeInTheDocument();
      expect(screen.getByLabelText('Export STL')).toBeInTheDocument();
      expect(screen.getByLabelText('Export STLs')).toBeInTheDocument();
      expect(screen.getByLabelText('Export Settings')).toBeInTheDocument();
    });

    it('renders each radio option as a radio input type', () => {
      render(<ActionSelector />);
      
      const sliceRadio = screen.getByLabelText('Slice') as HTMLInputElement;
      const export3mfRadio = screen.getByLabelText('Export 3MF') as HTMLInputElement;
      const exportStlRadio = screen.getByLabelText('Export STL') as HTMLInputElement;
      const exportStlsRadio = screen.getByLabelText('Export STLs') as HTMLInputElement;
      const exportSettingsRadio = screen.getByLabelText('Export Settings') as HTMLInputElement;
      
      expect(sliceRadio.type).toBe('radio');
      expect(export3mfRadio.type).toBe('radio');
      expect(exportStlRadio.type).toBe('radio');
      expect(exportStlsRadio.type).toBe('radio');
      expect(exportSettingsRadio.type).toBe('radio');
    });

    it('renders all radio options with the same name attribute for mutual exclusion', () => {
      render(<ActionSelector />);
      
      const sliceRadio = screen.getByLabelText('Slice') as HTMLInputElement;
      const export3mfRadio = screen.getByLabelText('Export 3MF') as HTMLInputElement;
      const exportStlRadio = screen.getByLabelText('Export STL') as HTMLInputElement;
      const exportStlsRadio = screen.getByLabelText('Export STLs') as HTMLInputElement;
      const exportSettingsRadio = screen.getByLabelText('Export Settings') as HTMLInputElement;
      
      expect(sliceRadio.name).toBe('action');
      expect(export3mfRadio.name).toBe('action');
      expect(exportStlRadio.name).toBe('action');
      expect(exportStlsRadio.name).toBe('action');
      expect(exportSettingsRadio.name).toBe('action');
    });

    it('has Slice selected by default', () => {
      render(<ActionSelector />);
      
      const sliceRadio = screen.getByLabelText('Slice') as HTMLInputElement;
      expect(sliceRadio.checked).toBe(true);
    });

    it('allows selecting each radio option', () => {
      render(<ActionSelector />);
      
      // Test each action can be selected
      const export3mfRadio = screen.getByLabelText('Export 3MF') as HTMLInputElement;
      fireEvent.click(export3mfRadio);
      expect(export3mfRadio.checked).toBe(true);

      const exportStlRadio = screen.getByLabelText('Export STL') as HTMLInputElement;
      fireEvent.click(exportStlRadio);
      expect(exportStlRadio.checked).toBe(true);

      const exportStlsRadio = screen.getByLabelText('Export STLs') as HTMLInputElement;
      fireEvent.click(exportStlsRadio);
      expect(exportStlsRadio.checked).toBe(true);

      const exportSettingsRadio = screen.getByLabelText('Export Settings') as HTMLInputElement;
      fireEvent.click(exportSettingsRadio);
      expect(exportSettingsRadio.checked).toBe(true);

      const sliceRadio = screen.getByLabelText('Slice') as HTMLInputElement;
      fireEvent.click(sliceRadio);
      expect(sliceRadio.checked).toBe(true);
    });
  });

  describe('Conditional UI: Plate Selector (Requirement 5.2)', () => {
    it('shows plate selector when Slice is selected', () => {
      render(<ActionSelector />);
      
      // Slice is selected by default
      expect(screen.getByText('Plate Selection')).toBeInTheDocument();
      
      // Verify plate selector dropdown is present
      const plateSelector = screen.getByDisplayValue('All Plates') as HTMLSelectElement;
      expect(plateSelector).toBeInTheDocument();
    });

    it('plate selector contains all expected options', () => {
      render(<ActionSelector />);
      
      const plateSelector = screen.getByDisplayValue('All Plates') as HTMLSelectElement;
      
      // Verify all plate options exist
      expect(screen.getByText('All Plates')).toBeInTheDocument();
      expect(screen.getByText('Plate 1')).toBeInTheDocument();
      expect(screen.getByText('Plate 2')).toBeInTheDocument();
      expect(screen.getByText('Plate 3')).toBeInTheDocument();
      expect(screen.getByText('Plate 4')).toBeInTheDocument();
      expect(screen.getByText('Plate 5')).toBeInTheDocument();
      expect(screen.getByText('Plate 6')).toBeInTheDocument();
      expect(screen.getByText('Plate 7')).toBeInTheDocument();
      expect(screen.getByText('Plate 8')).toBeInTheDocument();
    });

    it('hides plate selector when Export 3MF is selected', () => {
      render(<ActionSelector />);
      
      // Select Export 3MF
      fireEvent.click(screen.getByLabelText('Export 3MF'));
      
      // Plate selector should not be visible
      expect(screen.queryByText('Plate Selection')).not.toBeInTheDocument();
    });

    it('hides plate selector when Export STL is selected', () => {
      render(<ActionSelector />);
      
      // Select Export STL
      fireEvent.click(screen.getByLabelText('Export STL'));
      
      // Plate selector should not be visible
      expect(screen.queryByText('Plate Selection')).not.toBeInTheDocument();
    });

    it('hides plate selector when Export STLs is selected', () => {
      render(<ActionSelector />);
      
      // Select Export STLs
      fireEvent.click(screen.getByLabelText('Export STLs'));
      
      // Plate selector should not be visible
      expect(screen.queryByText('Plate Selection')).not.toBeInTheDocument();
    });

    it('hides plate selector when Export Settings is selected', () => {
      render(<ActionSelector />);
      
      // Select Export Settings
      fireEvent.click(screen.getByLabelText('Export Settings'));
      
      // Plate selector should not be visible
      expect(screen.queryByText('Plate Selection')).not.toBeInTheDocument();
    });

    it('allows changing plate number', () => {
      render(<ActionSelector />);
      
      const plateSelector = screen.getByDisplayValue('All Plates') as HTMLSelectElement;
      
      // Initially set to All Plates (0)
      expect(plateSelector.value).toBe('0');
      
      // Change to Plate 2
      fireEvent.change(plateSelector, { target: { value: '2' } });
      expect(plateSelector.value).toBe('2');
    });
  });

  describe('Conditional UI: Output Filename (Requirements 5.3, 5.4)', () => {
    it('shows output filename input when Export 3MF is selected with default value', () => {
      render(<ActionSelector />);
      
      // Select Export 3MF
      fireEvent.click(screen.getByLabelText('Export 3MF'));
      
      // Output filename input should be visible
      expect(screen.getByText('Output Filename')).toBeInTheDocument();
      
      const filenameInput = screen.getByPlaceholderText('output.3mf') as HTMLInputElement;
      expect(filenameInput).toBeInTheDocument();
      expect(filenameInput).toHaveValue('output.3mf');
    });

    it('shows output filename input when Export Settings is selected with default value', () => {
      render(<ActionSelector />);
      
      // Select Export Settings
      fireEvent.click(screen.getByLabelText('Export Settings'));
      
      // Output filename input should be visible
      expect(screen.getByText('Output Filename')).toBeInTheDocument();
      
      const filenameInput = screen.getByPlaceholderText('output.json') as HTMLInputElement;
      expect(filenameInput).toBeInTheDocument();
      expect(filenameInput).toHaveValue('output.json');
    });

    it('hides output filename input when Slice is selected', () => {
      render(<ActionSelector />);
      
      // First select Export 3MF to show the input
      fireEvent.click(screen.getByLabelText('Export 3MF'));
      expect(screen.getByPlaceholderText('output.3mf')).toBeInTheDocument();
      
      // Then select Slice
      fireEvent.click(screen.getByLabelText('Slice'));
      
      // Output filename input should not be visible
      expect(screen.queryByPlaceholderText('output.3mf')).not.toBeInTheDocument();
      expect(screen.queryByText('Output Filename')).not.toBeInTheDocument();
    });

    it('hides output filename input when Export STL is selected', () => {
      render(<ActionSelector />);
      
      // Select Export STL
      fireEvent.click(screen.getByLabelText('Export STL'));
      
      // Output filename input should not be visible
      expect(screen.queryByText('Output Filename')).not.toBeInTheDocument();
    });

    it('hides output filename input when Export STLs is selected', () => {
      render(<ActionSelector />);
      
      // Select Export STLs
      fireEvent.click(screen.getByLabelText('Export STLs'));
      
      // Output filename input should not be visible
      expect(screen.queryByText('Output Filename')).not.toBeInTheDocument();
    });

    it('allows editing output filename', () => {
      render(<ActionSelector />);
      
      // Select Export 3MF to show filename input
      fireEvent.click(screen.getByLabelText('Export 3MF'));
      
      const filenameInput = screen.getByPlaceholderText('output.3mf') as HTMLInputElement;
      
      // Change filename
      fireEvent.change(filenameInput, { target: { value: 'custom-output.3mf' } });
      expect(filenameInput.value).toBe('custom-output.3mf');
    });

    it('updates default filename when switching between Export 3MF and Export Settings', () => {
      render(<ActionSelector />);
      
      // Select Export 3MF
      fireEvent.click(screen.getByLabelText('Export 3MF'));
      const filenameInput3mf = screen.getByPlaceholderText('output.3mf') as HTMLInputElement;
      expect(filenameInput3mf.value).toBe('output.3mf');
      
      // Switch to Export Settings
      fireEvent.click(screen.getByLabelText('Export Settings'));
      const filenameInputJson = screen.getByPlaceholderText('output.json') as HTMLInputElement;
      expect(filenameInputJson.value).toBe('output.json');
    });
  });

  describe('Action Flags Checkboxes (Requirement 5.6)', () => {
    it('renders all six action flag checkboxes', () => {
      render(<ActionSelector />);
      
      expect(screen.getByLabelText('Minimal Save')).toBeInTheDocument();
      expect(screen.getByLabelText('No Check')).toBeInTheDocument();
      expect(screen.getByLabelText('Normative Check')).toBeInTheDocument();
      expect(screen.getByLabelText('Up-to-date Check')).toBeInTheDocument();
      expect(screen.getByLabelText('Load Default Filament')).toBeInTheDocument();
      expect(screen.getByLabelText('Enable Timelapse')).toBeInTheDocument();
    });

    it('renders each action flag as a checkbox input type', () => {
      render(<ActionSelector />);
      
      const minSave = screen.getByLabelText('Minimal Save') as HTMLInputElement;
      const noCheck = screen.getByLabelText('No Check') as HTMLInputElement;
      const normativeCheck = screen.getByLabelText('Normative Check') as HTMLInputElement;
      const uptodate = screen.getByLabelText('Up-to-date Check') as HTMLInputElement;
      const loadDefaultFila = screen.getByLabelText('Load Default Filament') as HTMLInputElement;
      const enableTimelapse = screen.getByLabelText('Enable Timelapse') as HTMLInputElement;
      
      expect(minSave.type).toBe('checkbox');
      expect(noCheck.type).toBe('checkbox');
      expect(normativeCheck.type).toBe('checkbox');
      expect(uptodate.type).toBe('checkbox');
      expect(loadDefaultFila.type).toBe('checkbox');
      expect(enableTimelapse.type).toBe('checkbox');
    });

    it('all action flags start unchecked', () => {
      render(<ActionSelector />);
      
      const minSave = screen.getByLabelText('Minimal Save') as HTMLInputElement;
      const noCheck = screen.getByLabelText('No Check') as HTMLInputElement;
      const normativeCheck = screen.getByLabelText('Normative Check') as HTMLInputElement;
      const uptodate = screen.getByLabelText('Up-to-date Check') as HTMLInputElement;
      const loadDefaultFila = screen.getByLabelText('Load Default Filament') as HTMLInputElement;
      const enableTimelapse = screen.getByLabelText('Enable Timelapse') as HTMLInputElement;
      
      expect(minSave.checked).toBe(false);
      expect(noCheck.checked).toBe(false);
      expect(normativeCheck.checked).toBe(false);
      expect(uptodate.checked).toBe(false);
      expect(loadDefaultFila.checked).toBe(false);
      expect(enableTimelapse.checked).toBe(false);
    });

    it('toggles each action flag checkbox correctly', () => {
      render(<ActionSelector />);
      
      const minSaveCheckbox = screen.getByLabelText('Minimal Save') as HTMLInputElement;
      
      // Click to check
      fireEvent.click(minSaveCheckbox);
      expect(minSaveCheckbox.checked).toBe(true);
      
      // Click to uncheck
      fireEvent.click(minSaveCheckbox);
      expect(minSaveCheckbox.checked).toBe(false);
    });

    it('allows multiple action flags to be checked simultaneously', () => {
      render(<ActionSelector />);
      
      const minSave = screen.getByLabelText('Minimal Save') as HTMLInputElement;
      const noCheck = screen.getByLabelText('No Check') as HTMLInputElement;
      const enableTimelapse = screen.getByLabelText('Enable Timelapse') as HTMLInputElement;
      
      // Check multiple flags
      fireEvent.click(minSave);
      fireEvent.click(noCheck);
      fireEvent.click(enableTimelapse);
      
      expect(minSave.checked).toBe(true);
      expect(noCheck.checked).toBe(true);
      expect(enableTimelapse.checked).toBe(true);
    });
  });
});
