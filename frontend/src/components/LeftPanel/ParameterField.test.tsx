/**
 * ParameterField Component Tests
 * 
 * Tests rendering of different parameter types and validation:
 * - Numeric inputs (float/int) with min/max validation
 * - Boolean inputs (checkbox)
 * - Enum inputs (dropdown)
 * - String inputs (text)
 * - Validation error display
 * - Override state indication
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ParameterField } from './ParameterField';
import { ParameterDescriptor } from '../../store/parameterSlice';
import { useStore } from '../../store';

// Mock the store
vi.mock('../../store', () => ({
  useStore: vi.fn(),
}));

describe('ParameterField', () => {
  const mockSetOverride = vi.fn();
  const mockClearOverride = vi.fn();
  // Mirrors parameterSlice's real getEffectiveDefault: profile-loaded value
  // if present, otherwise the descriptor's global default_value.
  const mockGetEffectiveDefault = vi.fn(
    (descriptor: ParameterDescriptor) => descriptor.default_value
  );

  const defaultStoreState = {
    overrides: {},
    validationErrors: {},
    profileDefaults: {},
    setOverride: mockSetOverride,
    clearOverride: mockClearOverride,
    getEffectiveDefault: mockGetEffectiveDefault,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(defaultStoreState);
  });

  describe('Float Parameter', () => {
    const floatDescriptor: ParameterDescriptor = {
      key: 'layer_height',
      label: 'Layer Height',
      tooltip: 'Height of each layer in mm',
      type: 'float',
      default_value: 0.2,
      min: 0.05,
      max: 0.4,
      section: 'quality',
    };

    it('renders numeric input for float type', () => {
      render(<ParameterField descriptor={floatDescriptor} />);

      const input = screen.getByLabelText('Layer Height') as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(input.type).toBe('number');
      expect(input.step).toBe('any');
      expect(input.value).toBe('0.2');
    });

    it('does not render min/max range as visible text (shown in tooltip instead)', () => {
      render(<ParameterField descriptor={floatDescriptor} />);

      expect(screen.queryByText('Range: 0.05 - 0.4')).not.toBeInTheDocument();
    });

    it('includes range in the tooltip', () => {
      render(<ParameterField descriptor={floatDescriptor} />);

      const input = screen.getByLabelText('Layer Height');
      expect(input.getAttribute('title')).toContain('Range: 0.05 - 0.4');
    });

    it('calls setOverride when value changes', async () => {
      const user = userEvent.setup();
      render(<ParameterField descriptor={floatDescriptor} />);

      const input = screen.getByLabelText('Layer Height') as HTMLInputElement;
      
      // Focus input and change value
      await user.clear(input);
      await user.type(input, '0.15');

      // Check that setOverride was called with layer_height key
      expect(mockSetOverride).toHaveBeenCalled();
      const calls = mockSetOverride.mock.calls;
      expect(calls.some(call => call[0] === 'layer_height')).toBe(true);
    });

    it('displays validation error when present', () => {
      (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...defaultStoreState,
        validationErrors: { layer_height: 'Value must be at least 0.05' },
      });

      render(<ParameterField descriptor={floatDescriptor} />);

      expect(screen.getByText('Value must be at least 0.05')).toBeInTheDocument();
      
      const input = screen.getByLabelText('Layer Height');
      expect(input).toHaveClass('border-red-500');
    });

    it('shows reset button when overridden', () => {
      (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...defaultStoreState,
        overrides: { layer_height: 0.3 },
      });

      render(<ParameterField descriptor={floatDescriptor} />);

      const resetButton = screen.getByRole('button', { name: 'Reset' });
      expect(resetButton).toBeInTheDocument();
    });

    it('calls clearOverride when reset button clicked', async () => {
      const user = userEvent.setup();
      (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...defaultStoreState,
        overrides: { layer_height: 0.3 },
      });

      render(<ParameterField descriptor={floatDescriptor} />);

      const resetButton = screen.getByRole('button', { name: 'Reset' });
      await user.click(resetButton);

      expect(mockClearOverride).toHaveBeenCalledWith('layer_height');
    });
  });

  describe('Integer Parameter', () => {
    const intDescriptor: ParameterDescriptor = {
      key: 'wall_loops',
      label: 'Wall Loops',
      tooltip: 'Number of perimeter loops',
      type: 'int',
      default_value: 2,
      min: 1,
      max: 10,
      section: 'strength',
    };

    it('renders numeric input for int type with step=1', () => {
      render(<ParameterField descriptor={intDescriptor} />);

      const input = screen.getByLabelText('Wall Loops') as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(input.type).toBe('number');
      expect(input.step).toBe('1');
      expect(input.value).toBe('2');
    });

    it('calls setOverride with integer value', async () => {
      const user = userEvent.setup();
      render(<ParameterField descriptor={intDescriptor} />);

      const input = screen.getByLabelText('Wall Loops') as HTMLInputElement;
      
      // Focus input and change value
      await user.clear(input);
      await user.type(input, '3');

      // Check that setOverride was called with wall_loops key
      expect(mockSetOverride).toHaveBeenCalled();
      const calls = mockSetOverride.mock.calls;
      expect(calls.some(call => call[0] === 'wall_loops')).toBe(true);
    });
  });

  describe('Boolean Parameter', () => {
    const boolDescriptor: ParameterDescriptor = {
      key: 'enable_support',
      label: 'Enable Support',
      tooltip: 'Generate support structures',
      type: 'bool',
      default_value: false,
      section: 'support',
    };

    it('renders checkbox for bool type', () => {
      render(<ParameterField descriptor={boolDescriptor} />);

      const checkbox = screen.getByLabelText('Enable Support') as HTMLInputElement;
      expect(checkbox).toBeInTheDocument();
      expect(checkbox.type).toBe('checkbox');
      expect(checkbox.checked).toBe(false);
    });

    it('calls setOverride with boolean value when toggled', async () => {
      const user = userEvent.setup();
      render(<ParameterField descriptor={boolDescriptor} />);

      const checkbox = screen.getByLabelText('Enable Support');
      await user.click(checkbox);

      expect(mockSetOverride).toHaveBeenCalledWith('enable_support', true);
    });

    it('displays overridden boolean value', () => {
      (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...defaultStoreState,
        overrides: { enable_support: true },
      });

      render(<ParameterField descriptor={boolDescriptor} />);

      const checkbox = screen.getByLabelText('Enable Support') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });
  });

  describe('Enum Parameter', () => {
    const enumDescriptor: ParameterDescriptor = {
      key: 'infill_pattern',
      label: 'Infill Pattern',
      tooltip: 'Pattern for infill generation',
      type: 'enum',
      default_value: 'grid',
      enum_values: ['grid', 'honeycomb', 'gyroid', 'triangle'],
      section: 'strength',
    };

    it('renders select dropdown for enum type', () => {
      render(<ParameterField descriptor={enumDescriptor} />);

      const select = screen.getByLabelText('Infill Pattern') as HTMLSelectElement;
      expect(select).toBeInTheDocument();
      expect(select.tagName).toBe('SELECT');
    });

    it('displays all enum values as options', () => {
      render(<ParameterField descriptor={enumDescriptor} />);

      expect(screen.getByRole('option', { name: 'grid' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'honeycomb' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'gyroid' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'triangle' })).toBeInTheDocument();
    });

    it('calls setOverride when selection changes', async () => {
      const user = userEvent.setup();
      render(<ParameterField descriptor={enumDescriptor} />);

      const select = screen.getByLabelText('Infill Pattern');
      await user.selectOptions(select, 'gyroid');

      expect(mockSetOverride).toHaveBeenCalledWith('infill_pattern', 'gyroid');
    });

    it('displays overridden enum value', () => {
      (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...defaultStoreState,
        overrides: { infill_pattern: 'honeycomb' },
      });

      render(<ParameterField descriptor={enumDescriptor} />);

      const select = screen.getByLabelText('Infill Pattern') as HTMLSelectElement;
      expect(select.value).toBe('honeycomb');
    });
  });

  describe('String Parameter', () => {
    const stringDescriptor: ParameterDescriptor = {
      key: 'printer_notes',
      label: 'Printer Notes',
      tooltip: 'Custom notes for this printer',
      type: 'string',
      default_value: '',
      section: 'other',
    };

    it('renders text input for string type', () => {
      render(<ParameterField descriptor={stringDescriptor} />);

      const input = screen.getByLabelText('Printer Notes') as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(input.type).toBe('text');
    });

    it('calls setOverride when text changes', async () => {
      const user = userEvent.setup();
      render(<ParameterField descriptor={stringDescriptor} />);

      const input = screen.getByLabelText('Printer Notes');
      await user.type(input, 'My custom note');

      expect(mockSetOverride).toHaveBeenCalled();
    });
  });

  describe('Unsupported Type', () => {
    it('displays message for unknown parameter type', () => {
      const unknownDescriptor = {
        key: 'unknown_param',
        label: 'Unknown',
        tooltip: 'Unknown type',
        type: 'unsupported_type' as any,
        default_value: '',
        section: 'other' as const,
      };

      render(<ParameterField descriptor={unknownDescriptor} />);

      expect(screen.getByText(/Unsupported parameter type/)).toBeInTheDocument();
    });
  });

  describe('Override Indication', () => {
    it('applies purple border to overridden numeric field', () => {
      const floatDescriptor: ParameterDescriptor = {
        key: 'layer_height',
        label: 'Layer Height',
        tooltip: 'Height of each layer',
        type: 'float',
        default_value: 0.2,
        section: 'quality',
      };

      (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...defaultStoreState,
        overrides: { layer_height: 0.3 },
      });

      render(<ParameterField descriptor={floatDescriptor} />);

      const input = screen.getByLabelText('Layer Height');
      expect(input).toHaveClass('border-purple-500');
    });
  });

  describe('Profile-derived default value', () => {
    const floatDescriptor: ParameterDescriptor = {
      key: 'layer_height',
      label: 'Layer Height',
      tooltip: 'Height of each layer',
      type: 'float',
      default_value: 0.2,
      section: 'quality',
    };

    it('shows the profile-loaded value (not the global default) when no user override exists', () => {
      (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...defaultStoreState,
        getEffectiveDefault: () => 0.28,
      });

      render(<ParameterField descriptor={floatDescriptor} />);

      const input = screen.getByLabelText('Layer Height') as HTMLInputElement;
      expect(input.value).toBe('0.28');
      // Not overridden by the user, so no Reset button and no purple border.
      expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
      expect(input).not.toHaveClass('border-purple-500');
    });

    it('includes the profile-loaded value as "Default" in the tooltip', () => {
      (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...defaultStoreState,
        getEffectiveDefault: () => 0.28,
      });

      render(<ParameterField descriptor={floatDescriptor} />);

      const input = screen.getByLabelText('Layer Height');
      expect(input.getAttribute('title')).toContain('Default: 0.28');
    });

    it('a user override still takes precedence over the profile-loaded default', () => {
      (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...defaultStoreState,
        overrides: { layer_height: 0.35 },
        getEffectiveDefault: () => 0.28,
      });

      render(<ParameterField descriptor={floatDescriptor} />);

      const input = screen.getByLabelText('Layer Height') as HTMLInputElement;
      expect(input.value).toBe('0.35');
      expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
    });
  });

  describe('Null max/min bounds', () => {
    it('does not display "null" in the tooltip range when max is null', () => {
      const descriptorWithNullMax: ParameterDescriptor = {
        key: 'layer_height',
        label: 'Layer Height',
        tooltip: 'Height of each layer',
        type: 'float',
        default_value: 0.2,
        min: 0,
        max: null,
        section: 'quality',
      };

      render(<ParameterField descriptor={descriptorWithNullMax} />);

      const input = screen.getByLabelText('Layer Height');
      const title = input.getAttribute('title') ?? '';
      expect(title).toContain('Range: 0 - -');
      expect(title).not.toContain('null');
    });

    it('does not set a max attribute on the input when max is null', () => {
      const descriptorWithNullMax: ParameterDescriptor = {
        key: 'layer_height',
        label: 'Layer Height',
        tooltip: 'Height of each layer',
        type: 'float',
        default_value: 0.2,
        min: 0,
        max: null,
        section: 'quality',
      };

      render(<ParameterField descriptor={descriptorWithNullMax} />);

      const input = screen.getByLabelText('Layer Height') as HTMLInputElement;
      expect(input.max).toBe('');
    });
  });

  describe('Tooltip Display', () => {
    it('includes description, parameter key, and default value in the tooltip', () => {
      const floatDescriptor: ParameterDescriptor = {
        key: 'layer_height',
        label: 'Layer Height',
        tooltip: 'Height of each layer in mm',
        type: 'float',
        default_value: 0.2,
        section: 'quality',
      };

      render(<ParameterField descriptor={floatDescriptor} />);

      const input = screen.getByLabelText('Layer Height');
      const title = input.getAttribute('title') ?? '';
      expect(title).toContain('Height of each layer in mm');
      expect(title).toContain('Parameter: layer_height');
      expect(title).toContain('Default: 0.2');
    });

    it('includes range in the tooltip when min/max are defined', () => {
      const floatDescriptor: ParameterDescriptor = {
        key: 'raft_first_layer_density',
        label: 'First layer density',
        tooltip: 'Density of the raft first layer.',
        type: 'float',
        default_value: 90,
        min: 10,
        max: 100,
        unit: '%',
        section: 'support',
      };

      render(<ParameterField descriptor={floatDescriptor} />);

      const input = screen.getByLabelText('First layer density');
      const title = input.getAttribute('title') ?? '';
      expect(title).toContain('Density of the raft first layer.');
      expect(title).toContain('Parameter: raft_first_layer_density');
      expect(title).toContain('Range: 10 - 100');
      expect(title).toContain('Default: 90 %');
    });

    it('formats boolean default values as enabled/disabled in the tooltip', () => {
      const boolDescriptor: ParameterDescriptor = {
        key: 'enable_support',
        label: 'Enable Support',
        tooltip: 'Generate support structures',
        type: 'bool',
        default_value: false,
        section: 'support',
      };

      render(<ParameterField descriptor={boolDescriptor} />);

      const checkbox = screen.getByLabelText('Enable Support');
      const title = checkbox.getAttribute('title') ?? '';
      expect(title).toContain('Parameter: enable_support');
      expect(title).toContain('Default: disabled');
    });
  });
});
