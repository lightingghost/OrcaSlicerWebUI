import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { act } from 'react';
import * as fc from 'fast-check';
import { ParameterField } from './ParameterField';
import { ParameterDescriptor } from '../../store/parameterSlice';
import { useStore } from '../../store';

/**
 * Property-Based Tests for ParameterField Component
 * 
 * Feature: orca-slicer-web-ui
 * Property 5: Parameter type determines rendered form control
 * 
 * **Validates: Requirements 3.2**
 * 
 * For any ParameterDescriptor with type = "float" or "int", the rendered React component
 * shall be a <input type="number">. For type = "bool" it shall be a <input type="checkbox">.
 * For type = "enum" it shall be a <select>. For type = "string" it shall be a <input type="text">.
 */

// Mock the store
vi.mock('../../store', () => ({
  useStore: vi.fn(),
}));

describe('ParameterField - Property-Based Tests', () => {
  const mockSetOverride = vi.fn();
  const mockClearOverride = vi.fn();
  const mockSetObjectOverride = vi.fn();
  const mockClearObjectOverride = vi.fn();

  /**
   * Builds a full mock store state. `getEffectiveValueForTarget` is derived
   * from `overrides`/`getEffectiveDefault` (mirroring parameterSlice's real
   * implementation for the 'global' target, the only target these tests
   * exercise). See ParameterField.test.tsx's buildMockStoreState for why a
   * fixed getter-on-spread approach doesn't work here.
   */
  function buildMockStoreState() {
    const getEffectiveDefault = (descriptor: ParameterDescriptor) => descriptor.default_value;
    const overrides: Record<string, unknown> = {};

    return {
      overrides,
      validationErrors: {},
      objectOverrides: {},
      objectValidationErrors: {},
      processTarget: 'global',
      profileDefaults: {},
      setOverride: mockSetOverride,
      clearOverride: mockClearOverride,
      setObjectOverride: mockSetObjectOverride,
      clearObjectOverride: mockClearObjectOverride,
      getEffectiveDefault,
      getEffectiveValueForTarget: (descriptor: ParameterDescriptor) => {
        const overrideValue = overrides[descriptor.key];
        if (overrideValue !== undefined) {
          return { value: overrideValue, isOverriddenAtTarget: true };
        }
        return { value: getEffectiveDefault(descriptor), isOverriddenAtTarget: false };
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(buildMockStoreState());
  });

  /**
   * Arbitrary generator for parameter keys
   * Generates valid parameter key strings (alphanumeric with underscores)
   * Avoids JavaScript reserved words and common object property names
   */
  const arbitraryParameterKey = (): fc.Arbitrary<string> => {
    const reservedWords = new Set([
      'constructor', 'prototype', '__proto__', 'toString', 'valueOf', 
      'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable'
    ]);
    
    return fc.stringOf(
      fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')
      ),
      { minLength: 3, maxLength: 30 }
    ).filter((key) => !reservedWords.has(key) && key.length > 0);
  };

  /**
   * Arbitrary generator for parameter labels
   * Generates human-readable labels
   */
  const arbitraryLabel = (): fc.Arbitrary<string> => {
    return fc.stringOf(
      fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-'.split('')
      ),
      { minLength: 3, maxLength: 50 }
    );
  };

  /**
   * Arbitrary generator for tooltips
   */
  const arbitraryTooltip = (): fc.Arbitrary<string> => {
    return fc.string({ minLength: 5, maxLength: 100 });
  };

  /**
   * Arbitrary generator for section types
   */
  const arbitrarySection = (): fc.Arbitrary<ParameterDescriptor['section']> => {
    return fc.constantFrom(
      'quality',
      'strength',
      'speed',
      'support',
      'multi_material',
      'gcode',
      'other'
    );
  };

  /**
   * Arbitrary generator for float parameter descriptors
   */
  const arbitraryFloatDescriptor = (): fc.Arbitrary<ParameterDescriptor> => {
    return fc.record({
      key: arbitraryParameterKey(),
      label: arbitraryLabel(),
      tooltip: arbitraryTooltip(),
      type: fc.constant('float' as const),
      default_value: fc.double({ min: -1000, max: 1000, noNaN: true }),
      min: fc.option(fc.double({ min: -1000, max: 1000, noNaN: true }), { nil: undefined }),
      max: fc.option(fc.double({ min: -1000, max: 1000, noNaN: true }), { nil: undefined }),
      section: arbitrarySection(),
    });
  };

  /**
   * Arbitrary generator for int parameter descriptors
   */
  const arbitraryIntDescriptor = (): fc.Arbitrary<ParameterDescriptor> => {
    return fc.record({
      key: arbitraryParameterKey(),
      label: arbitraryLabel(),
      tooltip: arbitraryTooltip(),
      type: fc.constant('int' as const),
      default_value: fc.integer({ min: -1000, max: 1000 }),
      min: fc.option(fc.integer({ min: -1000, max: 1000 }), { nil: undefined }),
      max: fc.option(fc.integer({ min: -1000, max: 1000 }), { nil: undefined }),
      section: arbitrarySection(),
    });
  };

  /**
   * Arbitrary generator for bool parameter descriptors
   */
  const arbitraryBoolDescriptor = (): fc.Arbitrary<ParameterDescriptor> => {
    return fc.record({
      key: arbitraryParameterKey(),
      label: arbitraryLabel(),
      tooltip: arbitraryTooltip(),
      type: fc.constant('bool' as const),
      default_value: fc.boolean(),
      section: arbitrarySection(),
    });
  };

  /**
   * Arbitrary generator for enum parameter descriptors
   */
  const arbitraryEnumDescriptor = (): fc.Arbitrary<ParameterDescriptor> => {
    // Generate 2-10 enum values
    const enumValuesArbitrary = fc.array(
      fc.stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_'.split('')),
        { minLength: 2, maxLength: 15 }
      ),
      { minLength: 2, maxLength: 10 }
    ).map((values) => [...new Set(values)]); // Remove duplicates

    return enumValuesArbitrary.chain((enumValues) =>
      fc.record({
        key: arbitraryParameterKey(),
        label: arbitraryLabel(),
        tooltip: arbitraryTooltip(),
        type: fc.constant('enum' as const),
        default_value: fc.constantFrom(...enumValues),
        enum_values: fc.constant(enumValues),
        section: arbitrarySection(),
      })
    );
  };

  /**
   * Arbitrary generator for string parameter descriptors
   */
  const arbitraryStringDescriptor = (): fc.Arbitrary<ParameterDescriptor> => {
    return fc.record({
      key: arbitraryParameterKey(),
      label: arbitraryLabel(),
      tooltip: arbitraryTooltip(),
      type: fc.constant('string' as const),
      default_value: fc.string({ maxLength: 100 }),
      section: arbitrarySection(),
    });
  };

  /**
   * Property Test: Float parameters render as <input type="number">
   * 
   * For any ParameterDescriptor with type = "float", the rendered component
   * shall be an <input> element with type="number".
   */
  it('should render <input type="number"> for any float parameter', () => {
    fc.assert(
      fc.property(arbitraryFloatDescriptor(), (descriptor) => {
        // Arrange & Act
        let container: HTMLElement;
        act(() => {
          const result = render(<ParameterField descriptor={descriptor} />);
          container = result.container;
        });

        // Assert: Find the input element by label
        const label = container!.querySelector(`label[for="param-${descriptor.key}"]`);
        expect(label).not.toBeNull();
        expect(label!.textContent).toContain(descriptor.label);

        const input = container!.querySelector(`#param-${descriptor.key}`) as HTMLInputElement;
        expect(input).not.toBeNull();
        expect(input.tagName).toBe('INPUT');
        expect(input.type).toBe('number');

        // Verify it's a number input with appropriate step
        expect(input.step).toBe('any'); // Float inputs should allow decimals

        // Cleanup
        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property Test: Int parameters render as <input type="number">
   * 
   * For any ParameterDescriptor with type = "int", the rendered component
   * shall be an <input> element with type="number".
   */
  it('should render <input type="number"> for any int parameter', () => {
    fc.assert(
      fc.property(arbitraryIntDescriptor(), (descriptor) => {
        // Arrange & Act
        let container: HTMLElement;
        act(() => {
          const result = render(<ParameterField descriptor={descriptor} />);
          container = result.container;
        });

        // Assert: Find the input element
        const input = container!.querySelector(`#param-${descriptor.key}`) as HTMLInputElement;
        expect(input).not.toBeNull();
        expect(input.tagName).toBe('INPUT');
        expect(input.type).toBe('number');

        // Verify it's an integer input with step=1
        expect(input.step).toBe('1');

        // Cleanup
        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property Test: Bool parameters render as <input type="checkbox">
   * 
   * For any ParameterDescriptor with type = "bool", the rendered component
   * shall be an <input> element with type="checkbox".
   */
  it('should render <input type="checkbox"> for any bool parameter', () => {
    fc.assert(
      fc.property(arbitraryBoolDescriptor(), (descriptor) => {
        // Arrange & Act
        let container: HTMLElement;
        act(() => {
          const result = render(<ParameterField descriptor={descriptor} />);
          container = result.container;
        });

        // Assert: Find the checkbox input
        const input = container!.querySelector(`#param-${descriptor.key}`) as HTMLInputElement;
        expect(input).not.toBeNull();
        expect(input.tagName).toBe('INPUT');
        expect(input.type).toBe('checkbox');

        // Verify the checkbox reflects the default value
        expect(input.checked).toBe(Boolean(descriptor.default_value));

        // Cleanup
        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property Test: Enum parameters render as <select>
   * 
   * For any ParameterDescriptor with type = "enum", the rendered component
   * shall be a <select> element.
   */
  it('should render <select> for any enum parameter', () => {
    fc.assert(
      fc.property(arbitraryEnumDescriptor(), (descriptor) => {
        // Arrange & Act
        let container: HTMLElement;
        act(() => {
          const result = render(<ParameterField descriptor={descriptor} />);
          container = result.container;
        });

        // Assert: Find the select element
        const select = container!.querySelector(`#param-${descriptor.key}`) as HTMLSelectElement;
        expect(select).not.toBeNull();
        expect(select.tagName).toBe('SELECT');

        // Verify all enum values are present as options
        const options = Array.from(select.querySelectorAll('option'));
        expect(options.length).toBe(descriptor.enum_values!.length);

        descriptor.enum_values!.forEach((value) => {
          const option = options.find((opt) => opt.value === value);
          expect(option).not.toBeUndefined();
          expect(option!.textContent).toBe(value);
        });

        // Cleanup
        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property Test: String parameters render as <input type="text">
   * 
   * For any ParameterDescriptor with type = "string", the rendered component
   * shall be an <input> element with type="text".
   */
  it('should render <input type="text"> for any string parameter', () => {
    fc.assert(
      fc.property(arbitraryStringDescriptor(), (descriptor) => {
        // Arrange & Act
        let container: HTMLElement;
        act(() => {
          const result = render(<ParameterField descriptor={descriptor} />);
          container = result.container;
        });

        // Assert: Find the text input
        const input = container!.querySelector(`#param-${descriptor.key}`) as HTMLInputElement;
        expect(input).not.toBeNull();
        expect(input.tagName).toBe('INPUT');
        expect(input.type).toBe('text');

        // Verify the input displays the default value
        expect(input.value).toBe(String(descriptor.default_value));

        // Cleanup
        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property Test: All parameter types render the correct control consistently
   * 
   * For any arbitrary ParameterDescriptor (regardless of type), the component
   * shall render exactly one of: number input, checkbox, select, or text input,
   * matching the parameter's type field.
   */
  it('should render the correct control type for any parameter descriptor', () => {
    const arbitraryDescriptor = fc.oneof(
      arbitraryFloatDescriptor(),
      arbitraryIntDescriptor(),
      arbitraryBoolDescriptor(),
      arbitraryEnumDescriptor(),
      arbitraryStringDescriptor()
    );

    fc.assert(
      fc.property(arbitraryDescriptor, (descriptor) => {
        // Arrange & Act
        let container: HTMLElement;
        act(() => {
          const result = render(<ParameterField descriptor={descriptor} />);
          container = result.container;
        });

        // Assert: Verify the correct element type based on parameter type
        const element = container!.querySelector(`#param-${descriptor.key}`);
        expect(element).not.toBeNull();

        switch (descriptor.type) {
          case 'float':
          case 'int': {
            const input = element as HTMLInputElement;
            expect(input.tagName).toBe('INPUT');
            expect(input.type).toBe('number');
            break;
          }
          case 'bool': {
            const input = element as HTMLInputElement;
            expect(input.tagName).toBe('INPUT');
            expect(input.type).toBe('checkbox');
            break;
          }
          case 'enum': {
            const select = element as HTMLSelectElement;
            expect(select.tagName).toBe('SELECT');
            break;
          }
          case 'string': {
            const input = element as HTMLInputElement;
            expect(input.tagName).toBe('INPUT');
            expect(input.type).toBe('text');
            break;
          }
          default:
            throw new Error(`Unexpected parameter type: ${(descriptor as any).type}`);
        }

        // Cleanup
        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property Test: Label is always associated with the correct input
   * 
   * For any parameter descriptor, the label element should be properly
   * associated with its input via the for/id attributes.
   */
  it('should associate label with input for any parameter type', () => {
    const arbitraryDescriptor = fc.oneof(
      arbitraryFloatDescriptor(),
      arbitraryIntDescriptor(),
      arbitraryBoolDescriptor(),
      arbitraryEnumDescriptor(),
      arbitraryStringDescriptor()
    );

    fc.assert(
      fc.property(arbitraryDescriptor, (descriptor) => {
        // Arrange & Act
        let container: HTMLElement;
        act(() => {
          const result = render(<ParameterField descriptor={descriptor} />);
          container = result.container;
        });

        // Assert: Find the label and verify it points to the correct input
        const expectedId = `param-${descriptor.key}`;
        const label = container!.querySelector(`label[for="${expectedId}"]`);
        const input = container!.querySelector(`#${expectedId}`);

        expect(label).not.toBeNull();
        expect(input).not.toBeNull();

        // Verify label text contains the descriptor label
        expect(label!.textContent).toContain(descriptor.label);

        // Cleanup
        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property Test: Tooltip is set for all parameter types
   * 
   * For any parameter descriptor, the rendered control should have a
   * composite tooltip (accessible via title attribute) that includes the
   * description, the parameter's internal key name, and its default value
   * (plus its range, for numeric types with min/max defined). This is set
   * on both the label and the input/select element for every type.
   */
  it('should set a composite tooltip (description, key, default) as title attribute for any parameter type', () => {
    const arbitraryDescriptor = fc.oneof(
      arbitraryFloatDescriptor(),
      arbitraryIntDescriptor(),
      arbitraryBoolDescriptor(),
      arbitraryEnumDescriptor(),
      arbitraryStringDescriptor()
    );

    fc.assert(
      fc.property(arbitraryDescriptor, (descriptor) => {
        // Arrange & Act
        let container: HTMLElement;
        act(() => {
          const result = render(<ParameterField descriptor={descriptor} />);
          container = result.container;
        });

        const label = container!.querySelector(`label[for="param-${descriptor.key}"]`);
        const element = container!.querySelector(`#param-${descriptor.key}`);
        expect(label).not.toBeNull();
        expect(element).not.toBeNull();

        const title = element!.getAttribute('title') ?? '';
        expect(title).toContain(descriptor.tooltip);
        expect(title).toContain(`Parameter: ${descriptor.key}`);

        if (
          (descriptor.type === 'float' || descriptor.type === 'int') &&
          (descriptor.min !== undefined || descriptor.max !== undefined)
        ) {
          const min = descriptor.min !== undefined ? descriptor.min : '-';
          const max = descriptor.max !== undefined ? descriptor.max : '-';
          expect(title).toContain(`Range: ${min} - ${max}`);
        }

        // Label carries the same composite tooltip as the control.
        expect(label!.getAttribute('title')).toBe(title);

        // Cleanup
        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property Test: Min/max attributes are set for numeric parameters
   * 
   * For any float or int parameter with defined min/max values, the rendered
   * number input should have the corresponding min and max attributes.
   */
  it('should set min/max attributes for numeric parameters when defined', () => {
    const arbitraryNumericDescriptor = fc.oneof(
      arbitraryFloatDescriptor(),
      arbitraryIntDescriptor()
    );

    fc.assert(
      fc.property(arbitraryNumericDescriptor, (descriptor) => {
        // Arrange & Act
        let container: HTMLElement;
        act(() => {
          const result = render(<ParameterField descriptor={descriptor} />);
          container = result.container;
        });

        // Assert: Find the input and verify min/max
        const input = container!.querySelector(`#param-${descriptor.key}`) as HTMLInputElement;
        expect(input).not.toBeNull();

        if (descriptor.min !== undefined) {
          expect(input.min).toBe(String(descriptor.min));
        }

        if (descriptor.max !== undefined) {
          expect(input.max).toBe(String(descriptor.max));
        }

        // Cleanup
        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property Test: Default value is displayed for all parameter types
   * 
   * For any parameter descriptor, the rendered control should display or
   * reflect the default_value specified in the descriptor.
   */
  it('should display default value for any parameter type', () => {
    const arbitraryDescriptor = fc.oneof(
      arbitraryFloatDescriptor(),
      arbitraryIntDescriptor(),
      arbitraryBoolDescriptor(),
      arbitraryEnumDescriptor(),
      arbitraryStringDescriptor()
    );

    fc.assert(
      fc.property(arbitraryDescriptor, (descriptor) => {
        // Arrange & Act
        let container: HTMLElement;
        act(() => {
          const result = render(<ParameterField descriptor={descriptor} />);
          container = result.container;
        });

        // Assert: Verify default value is displayed
        const element = container!.querySelector(`#param-${descriptor.key}`);
        expect(element).not.toBeNull();

        switch (descriptor.type) {
          case 'float':
          case 'int':
          case 'string': {
            const input = element as HTMLInputElement;
            // The component uses currentValue which is overrides[key] ?? default_value
            // Since we don't have overrides in the store, it should show default_value
            expect(input.value).toBe(String(descriptor.default_value));
            break;
          }
          case 'bool': {
            const input = element as HTMLInputElement;
            // For boolean, the component uses Boolean(currentValue)
            // Where currentValue = overrides[key] ?? default_value
            const expectedChecked = Boolean(descriptor.default_value);
            expect(input.checked).toBe(expectedChecked);
            break;
          }
          case 'enum': {
            const select = element as HTMLSelectElement;
            expect(select.value).toBe(String(descriptor.default_value));
            break;
          }
        }

        // Cleanup
        cleanup();
      }),
      { numRuns: 100 }
    );
  });
});
