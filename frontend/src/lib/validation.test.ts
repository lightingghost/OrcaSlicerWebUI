import { describe, it, expect } from 'vitest';
import { validateParameter } from './validation';
import { ParameterDescriptor } from '../store/parameterSlice';

describe('validateParameter', () => {
  describe('numeric types (float/int)', () => {
    describe('float type', () => {
      const floatDescriptor: ParameterDescriptor = {
        key: 'layer_height',
        label: 'Layer Height',
        tooltip: 'Height of each layer',
        type: 'float',
        default_value: 0.2,
        min: 0.05,
        max: 0.4,
        section: 'quality',
      };

      it('should return null for valid float within range', () => {
        expect(validateParameter(floatDescriptor, 0.2)).toBeNull();
        expect(validateParameter(floatDescriptor, 0.15)).toBeNull();
        expect(validateParameter(floatDescriptor, 0.3)).toBeNull();
      });

      it('should return null for boundary values', () => {
        expect(validateParameter(floatDescriptor, 0.05)).toBeNull();
        expect(validateParameter(floatDescriptor, 0.4)).toBeNull();
      });

      it('should return error for value below minimum', () => {
        const error = validateParameter(floatDescriptor, 0.04);
        expect(error).toBe('Value must be at least 0.05');
      });

      it('should return error for value above maximum', () => {
        const error = validateParameter(floatDescriptor, 0.41);
        expect(error).toBe('Value must be at most 0.4');
      });

      it('should return error for NaN string', () => {
        const error = validateParameter(floatDescriptor, 'not-a-number');
        expect(error).toBe('Invalid float value');
      });

      it('should accept string representation of valid number', () => {
        expect(validateParameter(floatDescriptor, '0.2')).toBeNull();
      });

      it('should handle float descriptor without min/max', () => {
        const descriptorNoLimits: ParameterDescriptor = {
          ...floatDescriptor,
          min: undefined,
          max: undefined,
        };
        expect(validateParameter(descriptorNoLimits, 999.99)).toBeNull();
        expect(validateParameter(descriptorNoLimits, -999.99)).toBeNull();
      });

      it('should handle float descriptor with only min', () => {
        const descriptorMinOnly: ParameterDescriptor = {
          ...floatDescriptor,
          max: undefined,
        };
        expect(validateParameter(descriptorMinOnly, 1000)).toBeNull();
        expect(validateParameter(descriptorMinOnly, 0.04)).toBe('Value must be at least 0.05');
      });

      it('should handle float descriptor with only max', () => {
        const descriptorMaxOnly: ParameterDescriptor = {
          ...floatDescriptor,
          min: undefined,
        };
        expect(validateParameter(descriptorMaxOnly, -1000)).toBeNull();
        expect(validateParameter(descriptorMaxOnly, 0.41)).toBe('Value must be at most 0.4');
      });

      it('should treat a null max the same as an absent max (no upper bound check)', () => {
        // The backend serializes an absent upper bound as JSON `null`
        // (Optional[float] = None), not `undefined`. A value above the
        // stated min but with no real upper limit must not be rejected.
        const descriptorNullMax: ParameterDescriptor = {
          ...floatDescriptor,
          max: null,
        };
        expect(validateParameter(descriptorNullMax, 1000)).toBeNull();
        expect(validateParameter(descriptorNullMax, 0.04)).toBe('Value must be at least 0.05');
      });

      it('should treat a null min the same as an absent min (no lower bound check)', () => {
        const descriptorNullMin: ParameterDescriptor = {
          ...floatDescriptor,
          min: null,
        };
        expect(validateParameter(descriptorNullMin, -1000)).toBeNull();
        expect(validateParameter(descriptorNullMin, 0.41)).toBe('Value must be at most 0.4');
      });

      it('should accept any value when both min and max are null', () => {
        const descriptorNullBoth: ParameterDescriptor = {
          ...floatDescriptor,
          min: null,
          max: null,
        };
        expect(validateParameter(descriptorNullBoth, 999999)).toBeNull();
        expect(validateParameter(descriptorNullBoth, -999999)).toBeNull();
      });
    });

    describe('int type', () => {
      const intDescriptor: ParameterDescriptor = {
        key: 'wall_loops',
        label: 'Wall Loops',
        tooltip: 'Number of perimeter walls',
        type: 'int',
        default_value: 2,
        min: 1,
        max: 10,
        section: 'strength',
      };

      it('should return null for valid integer within range', () => {
        expect(validateParameter(intDescriptor, 2)).toBeNull();
        expect(validateParameter(intDescriptor, 5)).toBeNull();
      });

      it('should return null for boundary values', () => {
        expect(validateParameter(intDescriptor, 1)).toBeNull();
        expect(validateParameter(intDescriptor, 10)).toBeNull();
      });

      it('should return error for value below minimum', () => {
        const error = validateParameter(intDescriptor, 0);
        expect(error).toBe('Value must be at least 1');
      });

      it('should return error for value above maximum', () => {
        const error = validateParameter(intDescriptor, 11);
        expect(error).toBe('Value must be at most 10');
      });

      it('should return error for non-integer value', () => {
        const error = validateParameter(intDescriptor, 2.5);
        expect(error).toBe('Value must be an integer');
      });

      it('should accept string representation of valid integer', () => {
        expect(validateParameter(intDescriptor, '5')).toBeNull();
      });

      it('should reject string representation of float for int type', () => {
        const error = validateParameter(intDescriptor, '2.5');
        expect(error).toBe('Value must be an integer');
      });

      it('should return error for NaN string', () => {
        const error = validateParameter(intDescriptor, 'not-a-number');
        expect(error).toBe('Invalid int value');
      });

      it('should handle int descriptor without min/max', () => {
        const descriptorNoLimits: ParameterDescriptor = {
          ...intDescriptor,
          min: undefined,
          max: undefined,
        };
        expect(validateParameter(descriptorNoLimits, 9999)).toBeNull();
        expect(validateParameter(descriptorNoLimits, -9999)).toBeNull();
      });
    });

    describe('edge cases for numeric types', () => {
      it('should handle zero as a valid value', () => {
        const descriptor: ParameterDescriptor = {
          key: 'test',
          label: 'Test',
          tooltip: 'Test',
          type: 'float',
          default_value: 0,
          min: 0,
          max: 1,
          section: 'other',
        };
        expect(validateParameter(descriptor, 0)).toBeNull();
      });

      it('should handle negative numbers', () => {
        const descriptor: ParameterDescriptor = {
          key: 'test',
          label: 'Test',
          tooltip: 'Test',
          type: 'float',
          default_value: -5,
          min: -10,
          max: -1,
          section: 'other',
        };
        expect(validateParameter(descriptor, -5)).toBeNull();
        expect(validateParameter(descriptor, -11)).toBe('Value must be at least -10');
        expect(validateParameter(descriptor, 0)).toBe('Value must be at most -1');
      });

      it('should handle very large numbers', () => {
        const descriptor: ParameterDescriptor = {
          key: 'test',
          label: 'Test',
          tooltip: 'Test',
          type: 'float',
          default_value: 1000000,
          min: 0,
          max: 10000000,
          section: 'other',
        };
        expect(validateParameter(descriptor, 9999999)).toBeNull();
      });

      it('should handle very small numbers', () => {
        const descriptor: ParameterDescriptor = {
          key: 'test',
          label: 'Test',
          tooltip: 'Test',
          type: 'float',
          default_value: 0.0001,
          min: 0.00001,
          max: 0.001,
          section: 'other',
        };
        expect(validateParameter(descriptor, 0.0005)).toBeNull();
      });
    });
  });

  describe('bool type', () => {
    const boolDescriptor: ParameterDescriptor = {
      key: 'retraction',
      label: 'Enable Retraction',
      tooltip: 'Enable filament retraction',
      type: 'bool',
      default_value: true,
      section: 'other',
    };

    it('should return null for valid boolean true', () => {
      expect(validateParameter(boolDescriptor, true)).toBeNull();
    });

    it('should return null for valid boolean false', () => {
      expect(validateParameter(boolDescriptor, false)).toBeNull();
    });

    it('should return error for non-boolean value', () => {
      const error = validateParameter(boolDescriptor, 'true');
      expect(error).toBe('Value must be a boolean');
    });

    it('should return error for number as boolean', () => {
      const error = validateParameter(boolDescriptor, 1 as any);
      expect(error).toBe('Value must be a boolean');
    });
  });

  describe('enum type', () => {
    const enumDescriptor: ParameterDescriptor = {
      key: 'fill_pattern',
      label: 'Fill Pattern',
      tooltip: 'Infill pattern',
      type: 'enum',
      default_value: 'honeycomb',
      enum_values: ['honeycomb', 'grid', 'triangles', 'cubic'],
      section: 'strength',
    };

    it('should return null for valid enum value', () => {
      expect(validateParameter(enumDescriptor, 'honeycomb')).toBeNull();
      expect(validateParameter(enumDescriptor, 'grid')).toBeNull();
      expect(validateParameter(enumDescriptor, 'triangles')).toBeNull();
      expect(validateParameter(enumDescriptor, 'cubic')).toBeNull();
    });

    it('should return error for invalid enum value', () => {
      const error = validateParameter(enumDescriptor, 'invalid');
      expect(error).toBe('Value must be one of: honeycomb, grid, triangles, cubic');
    });

    it('should accept number as enum value if it converts to valid string', () => {
      const numericEnumDescriptor: ParameterDescriptor = {
        ...enumDescriptor,
        enum_values: ['0', '1', '2'],
      };
      expect(validateParameter(numericEnumDescriptor, 1)).toBeNull();
    });

    it('should reject number that does not match enum values', () => {
      const error = validateParameter(enumDescriptor, 123);
      expect(error).toBe('Value must be one of: honeycomb, grid, triangles, cubic');
    });

    it('should handle empty string enum value', () => {
      const descriptorWithEmpty: ParameterDescriptor = {
        ...enumDescriptor,
        enum_values: ['', 'option1', 'option2'],
      };
      expect(validateParameter(descriptorWithEmpty, '')).toBeNull();
    });

    it('should return error when enum_values is undefined', () => {
      const descriptorNoEnum: ParameterDescriptor = {
        ...enumDescriptor,
        enum_values: undefined,
      };
      const error = validateParameter(descriptorNoEnum, 'anything');
      expect(error).toBe('No enum values defined');
    });

    it('should return error when enum_values is empty array', () => {
      const descriptorEmptyEnum: ParameterDescriptor = {
        ...enumDescriptor,
        enum_values: [],
      };
      const error = validateParameter(descriptorEmptyEnum, 'anything');
      expect(error).toBe('Value must be one of: ');
    });
  });

  describe('string type', () => {
    const stringDescriptor: ParameterDescriptor = {
      key: 'gcode_comment',
      label: 'G-code Comment',
      tooltip: 'Custom comment in G-code',
      type: 'string',
      default_value: '',
      section: 'gcode',
    };

    it('should return null for valid string', () => {
      expect(validateParameter(stringDescriptor, 'test comment')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(validateParameter(stringDescriptor, '')).toBeNull();
    });

    it('should return null for string with special characters', () => {
      expect(validateParameter(stringDescriptor, 'test!@#$%^&*()')).toBeNull();
    });

    it('should return error for non-string value (number)', () => {
      const error = validateParameter(stringDescriptor, 123);
      expect(error).toBe('Value must be a string');
    });

    it('should return error for non-string value (boolean)', () => {
      const error = validateParameter(stringDescriptor, true);
      expect(error).toBe('Value must be a string');
    });
  });

  describe('unknown type', () => {
    it('should return error for unknown parameter type', () => {
      const unknownDescriptor = {
        key: 'test',
        label: 'Test',
        tooltip: 'Test',
        type: 'unknown_type' as any,
        default_value: 'test',
        section: 'other' as const,
      };
      const error = validateParameter(unknownDescriptor, 'anything');
      expect(error).toBe('Unknown parameter type: unknown_type');
    });
  });

  describe('property 6 validation (Requirements 3.3, 3.6)', () => {
    it('should validate numeric values against min/max constraints per Property 6', () => {
      // Property 6: For any ParameterDescriptor with declared min and max,
      // and for any numeric value outside [min, max], the function shall return an error string.
      // For any value within [min, max], it shall return null.

      const descriptor: ParameterDescriptor = {
        key: 'test_param',
        label: 'Test Parameter',
        tooltip: 'Test',
        type: 'float',
        default_value: 50,
        min: 10,
        max: 100,
        section: 'other',
      };

      // Values within range should return null
      expect(validateParameter(descriptor, 10)).toBeNull();
      expect(validateParameter(descriptor, 50)).toBeNull();
      expect(validateParameter(descriptor, 100)).toBeNull();
      expect(validateParameter(descriptor, 55.5)).toBeNull();

      // Values outside range should return error string
      expect(validateParameter(descriptor, 9)).toBeTruthy();
      expect(validateParameter(descriptor, 101)).toBeTruthy();
      expect(validateParameter(descriptor, -100)).toBeTruthy();
      expect(validateParameter(descriptor, 1000)).toBeTruthy();

      // Verify the error messages are descriptive
      expect(validateParameter(descriptor, 9)).toContain('at least 10');
      expect(validateParameter(descriptor, 101)).toContain('at most 100');
    });
  });
});

// ============================================================================
// Property-Based Tests (fast-check)
// ============================================================================

import * as fc from 'fast-check';

describe('validateParameter - Property-Based Tests', () => {
  describe('Property 6: Parameter validation rejects out-of-range values', () => {
    it('should correctly validate any numeric value against any min/max bounds', () => {
      // **Validates: Requirements 3.3, 3.6**
      
      fc.assert(
        fc.property(
          // Generate a descriptor with arbitrary but valid min/max bounds
          fc.record({
            key: fc.string({ minLength: 1 }),
            label: fc.string({ minLength: 1 }),
            tooltip: fc.string(),
            type: fc.constantFrom('float' as const, 'int' as const),
            default_value: fc.double(),
            min: fc.double({ min: -1000, max: 1000, noNaN: true }),
            max: fc.double({ min: -1000, max: 1000, noNaN: true }),
            section: fc.constantFrom('quality', 'strength', 'speed', 'support', 'multi_material', 'gcode', 'other') as fc.Arbitrary<'quality' | 'strength' | 'speed' | 'support' | 'multi_material' | 'gcode' | 'other'>,
          }).filter(desc => desc.min <= desc.max), // Ensure min <= max
          // Generate an arbitrary numeric value
          fc.double({ noNaN: true }),
          (descriptor, value) => {
            const result = validateParameter(descriptor, value);
            
            // For int type, convert value to what validation function sees
            const numValue = typeof value === 'number' ? value : parseFloat(String(value));
            
            // Check constraints in the same order as the validation function
            const isNonInteger = descriptor.type === 'int' && !Number.isInteger(numValue);
            const isBelowMin = descriptor.min !== undefined && numValue < descriptor.min;
            const isAboveMax = descriptor.max !== undefined && numValue > descriptor.max;
            
            if (isNonInteger) {
              // Value is not integer for int type - should return error (checked first in validation)
              expect(result).not.toBeNull();
              expect(result).toContain('must be an integer');
            } else if (isBelowMin) {
              // Value is below minimum - should return error
              expect(result).not.toBeNull();
              expect(result).toContain(`at least ${descriptor.min}`);
            } else if (isAboveMax) {
              // Value is above maximum - should return error
              expect(result).not.toBeNull();
              expect(result).toContain(`at most ${descriptor.max}`);
            } else {
              // Value is within range and valid type - should return null
              expect(result).toBeNull();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should validate boundary values correctly', () => {
      // **Validates: Requirements 3.3, 3.6**
      
      fc.assert(
        fc.property(
          // Generate descriptor with valid min/max
          fc.record({
            key: fc.string({ minLength: 1 }),
            label: fc.string({ minLength: 1 }),
            tooltip: fc.string(),
            type: fc.constant('float' as const),
            default_value: fc.double(),
            min: fc.double({ min: -100, max: 100, noNaN: true }),
            max: fc.double({ min: -100, max: 100, noNaN: true }),
            section: fc.constant('other' as const),
          }).filter(desc => desc.min < desc.max), // Ensure min < max (strict)
          (descriptor) => {
            // Test exact min value - should be valid
            const minResult = validateParameter(descriptor, descriptor.min);
            expect(minResult).toBeNull();
            
            // Test exact max value - should be valid
            const maxResult = validateParameter(descriptor, descriptor.max);
            expect(maxResult).toBeNull();
            
            // Test just below min - should be invalid
            const belowMinResult = validateParameter(descriptor, descriptor.min - 0.001);
            expect(belowMinResult).not.toBeNull();
            
            // Test just above max - should be invalid
            const aboveMaxResult = validateParameter(descriptor, descriptor.max + 0.001);
            expect(aboveMaxResult).not.toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle int type constraints correctly', () => {
      // **Validates: Requirements 3.3, 3.6**
      
      fc.assert(
        fc.property(
          // Generate int descriptor with bounds
          fc.record({
            key: fc.string({ minLength: 1 }),
            label: fc.string({ minLength: 1 }),
            tooltip: fc.string(),
            type: fc.constant('int' as const),
            default_value: fc.integer({ min: 1, max: 10 }),
            min: fc.integer({ min: 1, max: 50 }),
            max: fc.integer({ min: 50, max: 100 }),
            section: fc.constant('other' as const),
          }),
          // Generate integer or float value
          fc.oneof(
            fc.integer({ min: -100, max: 200 }),
            fc.double({ min: -100, max: 200, noNaN: true })
          ),
          (descriptor, value) => {
            const result = validateParameter(descriptor, value);
            
            const isInteger = Number.isInteger(value);
            const inRange = value >= descriptor.min && value <= descriptor.max;
            
            if (!isInteger) {
              // Non-integer for int type should fail
              expect(result).not.toBeNull();
              expect(result).toContain('must be an integer');
            } else if (!inRange) {
              // Out of range should fail
              expect(result).not.toBeNull();
            } else {
              // Valid integer in range should pass
              expect(result).toBeNull();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle descriptors without min or max constraints', () => {
      // **Validates: Requirements 3.3, 3.6**
      
      fc.assert(
        fc.property(
          // Generate descriptor without min/max
          fc.record({
            key: fc.string({ minLength: 1 }),
            label: fc.string({ minLength: 1 }),
            tooltip: fc.string(),
            type: fc.constantFrom('float' as const, 'int' as const),
            default_value: fc.double(),
            min: fc.constant(undefined),
            max: fc.constant(undefined),
            section: fc.constant('other' as const),
          }),
          fc.double({ noNaN: true }),
          (descriptor, value) => {
            const result = validateParameter(descriptor, value);
            
            // For int type, must be integer
            if (descriptor.type === 'int' && !Number.isInteger(value)) {
              expect(result).not.toBeNull();
            } else {
              // No bounds, so any valid number should pass
              expect(result).toBeNull();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle string representations of numbers', () => {
      // **Validates: Requirements 3.3, 3.6**
      
      fc.assert(
        fc.property(
          // Generate descriptor with bounds
          fc.record({
            key: fc.string({ minLength: 1 }),
            label: fc.string({ minLength: 1 }),
            tooltip: fc.string(),
            type: fc.constant('float' as const),
            default_value: fc.double(),
            min: fc.double({ min: 0, max: 50, noNaN: true }),
            max: fc.double({ min: 50, max: 100, noNaN: true }),
            section: fc.constant('other' as const),
          }),
          fc.double({ noNaN: true }),
          (descriptor, numericValue) => {
            // Test with numeric value
            const numResult = validateParameter(descriptor, numericValue);
            
            // Test with string representation
            const strResult = validateParameter(descriptor, String(numericValue));
            
            // Both should produce the same validation result
            if (numResult === null) {
              expect(strResult).toBeNull();
            } else {
              expect(strResult).not.toBeNull();
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
