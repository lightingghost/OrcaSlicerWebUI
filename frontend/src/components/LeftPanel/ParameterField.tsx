/**
 * ParameterField Component
 *
 * Renders a single parameter row laid out like the native OrcaSlicer
 * desktop UI: the option label on the left, the value control (plus its
 * unit, e.g. "mm" or "mm or %") on the right. The value column has a fixed
 * width so controls line up vertically across every row in a group,
 * regardless of parameter type (number, select, checkbox, text) - matching
 * the aligned columns in the native desktop app.
 *
 * Supported controls per parameter type:
 * - float/int: numeric input with min/max validation
 * - bool: checkbox
 * - enum: dropdown select
 * - string: text input
 *
 * Hovering any row shows a tooltip with the parameter description, its
 * internal key name (e.g. "raft_first_layer_density"), its valid range
 * (for numeric types), and its default value - matching what a developer
 * needs when tuning a print profile.
 *
 * Displays validation errors inline and wires to parameterSlice for state management.
 */

import { useStore } from '../../store';
import { ParameterDescriptor } from '../../store/parameterSlice';

interface ParameterFieldProps {
  descriptor: ParameterDescriptor;
}

/** Fixed width of the value column so all controls in a group align,
 * matching the native desktop UI's consistent right-hand column. */
const VALUE_COLUMN_WIDTH = 'w-[168px]';

function formatDefaultValue(
  effectiveDefault: string | number | boolean,
  type: ParameterDescriptor['type'],
  unit: ParameterDescriptor['unit']
): string {
  if (type === 'bool') {
    return effectiveDefault ? 'enabled' : 'disabled';
  }
  const suffix = unit ? ` ${unit}` : '';
  return `${effectiveDefault}${suffix}`;
}

function buildTooltip(
  descriptor: ParameterDescriptor,
  effectiveDefault: string | number | boolean
): string {
  const lines = [descriptor.tooltip, `Parameter: ${descriptor.key}`];

  if (
    (descriptor.type === 'float' || descriptor.type === 'int') &&
    (descriptor.min != null || descriptor.max != null)
  ) {
    const min = descriptor.min != null ? descriptor.min : '-';
    const max = descriptor.max != null ? descriptor.max : '-';
    lines.push(`Range: ${min} - ${max}`);
  }

  lines.push(`Default: ${formatDefaultValue(effectiveDefault, descriptor.type, descriptor.unit)}`);

  return lines.join('\n');
}

export const ParameterField: React.FC<ParameterFieldProps> = ({ descriptor }) => {
  const {
    validationErrors,
    objectValidationErrors,
    setOverride,
    clearOverride,
    setObjectOverride,
    clearObjectOverride,
    getEffectiveDefault,
    getEffectiveValueForTarget,
    processTarget,
  } = useStore();

  const isObjectTarget = processTarget !== 'global';
  const effectiveDefault = getEffectiveDefault(descriptor);
  const { value: currentValue, isOverriddenAtTarget: isOverridden } = getEffectiveValueForTarget(
    descriptor,
    processTarget
  );
  const error = isObjectTarget
    ? objectValidationErrors[processTarget]?.[descriptor.key]
    : validationErrors[descriptor.key];
  const unit = descriptor.unit;
  const tooltip = buildTooltip(descriptor, effectiveDefault);

  const handleChange = (value: string | number | boolean) => {
    if (isObjectTarget) {
      setObjectOverride(processTarget, descriptor.key, value);
    } else {
      setOverride(descriptor.key, value);
    }
  };

  const handleReset = () => {
    if (isObjectTarget) {
      clearObjectOverride(processTarget, descriptor.key);
    } else {
      clearOverride(descriptor.key);
    }
  };

  const resetButton = isOverridden ? (
    <button
      onClick={handleReset}
      className="text-xs text-purple-400 hover:text-purple-300 flex-shrink-0"
      title="Reset to default"
    >
      Reset
    </button>
  ) : null;

  // Boolean parameters render as a checkbox on the right, label on the left,
  // matching every other row (rather than the checkbox+label combo used
  // elsewhere in the app). The checkbox sits inside the same fixed-width
  // value column as every other control type so it aligns with them.
  if (descriptor.type === 'bool') {
    return (
      <div className="px-3 py-1.5 border-b border-gray-800/60 hover:bg-gray-800/40">
        <div className="flex items-center justify-between gap-3" title={tooltip}>
          <label
            htmlFor={`param-${descriptor.key}`}
            className="text-sm text-gray-300 flex-1 min-w-0 truncate cursor-pointer"
            title={tooltip}
          >
            {descriptor.label}
          </label>
          <div className={`flex items-center justify-end gap-2 flex-shrink-0 ${VALUE_COLUMN_WIDTH}`}>
            {resetButton}
            <input
              id={`param-${descriptor.key}`}
              type="checkbox"
              checked={Boolean(currentValue)}
              onChange={(e) => handleChange(e.target.checked)}
              className="w-4 h-4 bg-gray-700 border-gray-600 rounded text-purple-500 focus:ring-2 focus:ring-purple-500 focus:ring-offset-0"
              title={tooltip}
            />
          </div>
        </div>
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  // Numeric (float/int), enum, and string parameters share the same
  // label-left / control-right row shape, each control filling the same
  // fixed-width value column so they align across rows.
  let control: React.ReactNode;

  if (descriptor.type === 'float' || descriptor.type === 'int') {
    control = (
      <input
        id={`param-${descriptor.key}`}
        type="number"
        value={typeof currentValue === 'number' ? currentValue : String(currentValue)}
        onChange={(e) => {
          const val =
            descriptor.type === 'int' ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
          handleChange(isNaN(val) ? e.target.value : val);
        }}
        min={descriptor.min ?? undefined}
        max={descriptor.max ?? undefined}
        step={descriptor.type === 'int' ? '1' : 'any'}
        className={`min-w-0 flex-1 px-2 py-1 bg-gray-700 border rounded-md text-white text-sm text-right focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent ${
          error ? 'border-red-500' : 'border-gray-600'
        } ${isOverridden ? 'border-purple-500' : ''}`}
        title={tooltip}
      />
    );
  } else if (descriptor.type === 'enum') {
    control = (
      <select
        id={`param-${descriptor.key}`}
        value={String(currentValue)}
        onChange={(e) => handleChange(e.target.value)}
        className={`min-w-0 flex-1 px-2 py-1 bg-gray-700 border rounded-md text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent ${
          error ? 'border-red-500' : 'border-gray-600'
        } ${isOverridden ? 'border-purple-500' : ''}`}
        title={tooltip}
      >
        {descriptor.enum_values?.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    );
  } else if (descriptor.type === 'string') {
    control = (
      <input
        id={`param-${descriptor.key}`}
        type="text"
        value={String(currentValue)}
        onChange={(e) => handleChange(e.target.value)}
        className={`min-w-0 flex-1 px-2 py-1 bg-gray-700 border rounded-md text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent ${
          error ? 'border-red-500' : 'border-gray-600'
        } ${isOverridden ? 'border-purple-500' : ''}`}
        title={tooltip}
      />
    );
  } else {
    // Fallback for unknown types
    return (
      <div className="px-3 py-1.5 border-b border-gray-800/60">
        <p className="text-sm text-gray-400">Unsupported parameter type: {descriptor.type}</p>
      </div>
    );
  }

  return (
    <div className="px-3 py-1.5 border-b border-gray-800/60 hover:bg-gray-800/40">
      <div className="flex items-center justify-between gap-3" title={tooltip}>
        <label
          htmlFor={`param-${descriptor.key}`}
          className="text-sm text-gray-300 flex-1 min-w-0 truncate"
          title={tooltip}
        >
          {descriptor.label}
        </label>
        <div className={`flex items-center gap-2 flex-shrink-0 ${VALUE_COLUMN_WIDTH}`}>
          {resetButton}
          {control}
          {unit && (
            <span className="text-xs text-gray-500 whitespace-nowrap flex-shrink-0">{unit}</span>
          )}
        </div>
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
};
