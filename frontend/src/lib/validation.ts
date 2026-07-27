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

/**
 * Converts a parameter override value into the exact string form native
 * OrcaSlicer's own config deserializer expects (ConfigOptionBool /
 * ConfigOptionFloat / etc.'s `deserialize`, confirmed against
 * libslic3r/Config.hpp). Booleans MUST serialize as "1"/"0" — NOT
 * "true"/"false", which ConfigOptionBool::deserialize does not
 * recognize and would silently fail to apply (returns false without
 * throwing, leaving the option at its prior default).
 *
 * Used when building per-object config_overrides for a job's `instances`
 * (see JobInstancePlacement.config_overrides's doc comment) — those
 * values get embedded directly into the plate snapshot 3mf's
 * Metadata/model_settings.config and read back by the CLI's own
 * `config.set_deserialize`, so they must already be in the CLI's native
 * string form (unlike the top-level `parameter_overrides`, which the
 * backend's cli_builder.py passes as `--flag=value` CLI arguments, where
 * a plain JS-toString'd boolean/number already happens to work for the
 * CLI's own command-line parser).
 */
export function serializeParameterValueForCli(value: string | number | boolean): string {
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  return String(value);
}
