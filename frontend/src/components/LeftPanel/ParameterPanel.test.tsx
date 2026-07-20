/**
 * ParameterPanel Component Tests
 * 
 * Tests filtering of parameters by section/group and rendering of ParameterFields.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ParameterPanel } from './ParameterPanel';
import { ParameterDescriptor } from '../../store/parameterSlice';
import { useStore } from '../../store';

// Mock the store
vi.mock('../../store', () => ({
  useStore: vi.fn(),
}));

// Mock ParameterField component
vi.mock('./ParameterField', () => ({
  ParameterField: ({ descriptor }: { descriptor: ParameterDescriptor }) => (
    <div data-testid={`field-${descriptor.key}`}>{descriptor.label}</div>
  ),
}));

describe('ParameterPanel', () => {
  const defaultStoreState = {
    parameterDescriptors: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(defaultStoreState);
  });

  it('displays loading message when no descriptors are loaded', () => {
    render(<ParameterPanel section="quality" />);

    expect(screen.getByText('Loading parameters...')).toBeInTheDocument();
  });

  it('displays empty message when no parameters match the section', () => {
    const descriptors: ParameterDescriptor[] = [
      {
        key: 'layer_height',
        label: 'Layer Height',
        tooltip: 'Height of layer',
        type: 'float',
        default_value: 0.2,
        section: 'quality',
        group: 'Layer height',
        group_order: 0,
        order: 0,
      },
    ];

    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      parameterDescriptors: descriptors,
    });

    render(<ParameterPanel section="support" />);

    expect(screen.getByText('No parameters in this section')).toBeInTheDocument();
  });

  it('excludes parameters with no native UI group', () => {
    const descriptors: ParameterDescriptor[] = [
      {
        key: 'layer_height',
        label: 'Layer Height',
        tooltip: 'Height of layer',
        type: 'float',
        default_value: 0.2,
        section: 'quality',
        group: 'Layer height',
        group_order: 0,
        order: 0,
      },
      {
        key: 'ungrouped_param',
        label: 'Ungrouped Param',
        tooltip: 'Not part of the Process tab',
        type: 'string',
        default_value: '',
        section: 'quality',
        group: null,
      },
    ];

    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      parameterDescriptors: descriptors,
    });

    render(<ParameterPanel section="quality" />);

    expect(screen.getByTestId('field-layer_height')).toBeInTheDocument();
    expect(screen.queryByTestId('field-ungrouped_param')).not.toBeInTheDocument();
  });

  it('renders ParameterField for each descriptor matching the section', () => {
    const descriptors: ParameterDescriptor[] = [
      {
        key: 'layer_height',
        label: 'Layer Height',
        tooltip: 'Height of layer',
        type: 'float',
        default_value: 0.2,
        section: 'quality',
        group: 'Layer height',
        group_order: 0,
        order: 0,
      },
      {
        key: 'wall_loops',
        label: 'Wall Loops',
        tooltip: 'Number of walls',
        type: 'int',
        default_value: 2,
        section: 'strength',
        group: 'Walls',
        group_order: 0,
        order: 0,
      },
      {
        key: 'infill_density',
        label: 'Infill Density',
        tooltip: 'Density of infill',
        type: 'float',
        default_value: 20,
        section: 'quality',
        group: 'Layer height',
        group_order: 0,
        order: 1,
      },
    ];

    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      parameterDescriptors: descriptors,
    });

    render(<ParameterPanel section="quality" />);

    // Should render only quality section parameters
    expect(screen.getByTestId('field-layer_height')).toBeInTheDocument();
    expect(screen.getByTestId('field-infill_density')).toBeInTheDocument();
    expect(screen.queryByTestId('field-wall_loops')).not.toBeInTheDocument();
  });

  it('filters parameters correctly for strength section', () => {
    const descriptors: ParameterDescriptor[] = [
      {
        key: 'layer_height',
        label: 'Layer Height',
        tooltip: 'Height of layer',
        type: 'float',
        default_value: 0.2,
        section: 'quality',
        group: 'Layer height',
        group_order: 0,
        order: 0,
      },
      {
        key: 'wall_loops',
        label: 'Wall Loops',
        tooltip: 'Number of walls',
        type: 'int',
        default_value: 2,
        section: 'strength',
        group: 'Walls',
        group_order: 0,
        order: 0,
      },
      {
        key: 'infill_density',
        label: 'Infill Density',
        tooltip: 'Density of infill',
        type: 'float',
        default_value: 20,
        section: 'strength',
        group: 'Infill',
        group_order: 1,
        order: 0,
      },
    ];

    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      parameterDescriptors: descriptors,
    });

    render(<ParameterPanel section="strength" />);

    // Should render only strength section parameters
    expect(screen.getByTestId('field-wall_loops')).toBeInTheDocument();
    expect(screen.getByTestId('field-infill_density')).toBeInTheDocument();
    expect(screen.queryByTestId('field-layer_height')).not.toBeInTheDocument();
  });

  it('filters parameters correctly for all sections', () => {
    const sections: Array<'quality' | 'strength' | 'speed' | 'support' | 'multi_material' | 'gcode' | 'other'> = [
      'quality',
      'strength',
      'speed',
      'support',
      'multi_material',
      'gcode',
      'other',
    ];

    sections.forEach((section) => {
      const descriptors: ParameterDescriptor[] = [
        {
          key: `param_${section}`,
          label: `Param ${section}`,
          tooltip: `Parameter for ${section}`,
          type: 'float',
          default_value: 0,
          section,
          group: 'Some group',
          group_order: 0,
          order: 0,
        },
      ];

      (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        parameterDescriptors: descriptors,
      });

      const { unmount } = render(<ParameterPanel section={section} />);

      expect(screen.getByTestId(`field-param_${section}`)).toBeInTheDocument();

      unmount();
    });
  });

  it('renders group headers above each option group', () => {
    const descriptors: ParameterDescriptor[] = [
      {
        key: 'layer_height',
        label: 'Layer Height',
        tooltip: 'Height of layer',
        type: 'float',
        default_value: 0.2,
        section: 'quality',
        group: 'Layer height',
        group_order: 0,
        order: 0,
      },
      {
        key: 'line_width',
        label: 'Line Width',
        tooltip: 'Width of line',
        type: 'float',
        default_value: 0.4,
        section: 'quality',
        group: 'Line width',
        group_order: 1,
        order: 0,
      },
    ];

    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      parameterDescriptors: descriptors,
    });

    render(<ParameterPanel section="quality" />);

    expect(screen.getByText('Layer height')).toBeInTheDocument();
    expect(screen.getByText('Line width')).toBeInTheDocument();
  });

  it('renders with scrollable container for many parameters', () => {
    const descriptors: ParameterDescriptor[] = Array.from({ length: 20 }, (_, i) => ({
      key: `param_${i}`,
      label: `Parameter ${i}`,
      tooltip: `Tooltip ${i}`,
      type: 'float' as const,
      default_value: i,
      section: 'quality' as const,
      group: 'Some group',
      group_order: 0,
      order: i,
    }));

    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      parameterDescriptors: descriptors,
    });

    const { container } = render(<ParameterPanel section="quality" />);

    // Check that the container has overflow-y-auto and flexes to fill
    // available space (rather than a fixed max-height), so it scrolls
    // within the parent flex layout instead of the whole sidebar.
    const scrollContainer = container.querySelector('.overflow-y-auto');
    expect(scrollContainer).toBeInTheDocument();
    expect(scrollContainer).toHaveClass('flex-1');
    expect(scrollContainer).toHaveClass('min-h-0');
  });
});
