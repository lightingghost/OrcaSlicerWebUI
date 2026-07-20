/**
 * Validation utilities for parameter values
 */

import { ParameterDescriptor } from '../store/parameterSlice';

/**
 * Validates a parameter value against its descriptor.
 * 
 * Checks:
 * - min/max bounds for numeric types (float, int)
 * - enum value membership for enum type
 * - type correctness for all types
 * 
 * @param descriptor - The parameter descriptor containing validation rules
 * @param value - The value to validate
 * @returns Error string if invalid, null if valid
 */
export function validateParameter(
  descriptor: ParameterDescriptor,
  value: string | number | boolean
): string | null {
  switch (descriptor.type) {
    case 'float':
    case 'int': {
      const numValue = typeof value === 'number' ? value : parseFloat(String(value));

      if (isNaN(numValue)) {
        return `Invalid ${descriptor.type} value`;
      }

      if (descriptor.type === 'int' && !Number.isInteger(numValue)) {
        return 'Value must be an integer';
      }

      // Use `!= null` (loose) rather than `!== undefined` so that both
      // `undefined` and `null` bounds are treated as "no limit". The
      // backend serializes an absent bound as JSON `null`, which is not
      // `undefined` in JS/TS, so a strict `undefined` check would let a
      // `null` max through and then fail every value against `> null`.
      if (descriptor.min != null && numValue < descriptor.min) {
        return `Value must be at least ${descriptor.min}`;
      }

      if (descriptor.max != null && numValue > descriptor.max) {
        return `Value must be at most ${descriptor.max}`;
      }

      return null;
    }

    case 'bool': {
      if (typeof value !== 'boolean') {
        return 'Value must be a boolean';
      }
      return null;
    }

    case 'enum': {
      if (!descriptor.enum_values) {
        return 'No enum values defined';
      }

      const strValue = String(value);
      if (!descriptor.enum_values.includes(strValue)) {
        return `Value must be one of: ${descriptor.enum_values.join(', ')}`;
      }

      return null;
    }

    case 'string': {
      if (typeof value !== 'string') {
        return 'Value must be a string';
      }
      return null;
    }

    default:
      return `Unknown parameter type: ${(descriptor as any).type}`;
  }
}
