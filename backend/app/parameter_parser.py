"""
OrcaSlicer PrintConfig.cpp Parameter Parser

Parses the OrcaSlicer PrintConfig.cpp file to extract parameter descriptors
and generates a JSON snapshot for the API.

In addition to the raw parameter definitions (label, tooltip, type, default,
min/max, enum values) this parser also parses `TabPrint::build()` in
`Tab.cpp` -- the source of truth for how the native OrcaSlicer desktop app
organises Process settings into pages (Quality / Strength / Speed / Support /
Multimaterial / Others), option groups within each page (e.g. "Layer height",
"Line width", "Seam", ...), and the exact order options appear in.

Every parameter that appears in `TabPrint::build()` is tagged with the same
`section` (page), `group` (optgroup title), and `order` (position within the
group) as the native UI, so the web UI can replicate the native layout
exactly: same options, same groups, same order, left-label/right-value rows.

Parameters that are not part of the Process tab (printer/filament-only
settings) keep a best-effort `section` derived from their C++ `category`,
but have `group = None` and `order = None`.
"""

import re
import json
from pathlib import Path
from typing import Dict, List, Optional, Any


class ParameterParser:
    """Parser for extracting parameter definitions from PrintConfig.cpp"""

    # Type mapping from C++ config types to our API types
    TYPE_MAPPING = {
        'coFloat': 'float',
        'coFloats': 'float',
        'coFloatOrPercent': 'float',
        'coFloatsOrPercents': 'float',
        'coPercent': 'float',
        'coPercents': 'float',
        'coInt': 'int',
        'coInts': 'int',
        'coBool': 'bool',
        'coBools': 'bool',
        'coString': 'string',
        'coStrings': 'string',
        'coEnum': 'enum',
        'coPoint': 'string',
        'coPoints': 'string',
        'coPointsGroups': 'string',
    }

    # Fallback category -> section mapping, used only for parameters that
    # are not found in TabPrint::build() (i.e. not Process/Print settings).
    CATEGORY_TO_SECTION = {
        'Quality': 'quality',
        'Strength': 'strength',
        'Speed': 'speed',
        'Support': 'support',
        'Multi-material': 'multi_material',
        'G-code': 'gcode',
    }

    # Native OrcaSlicer TabPrint page titles -> our UI section slugs.
    # This ordering matches the exact page order in TabPrint::build().
    PAGE_TO_SECTION = {
        'Quality': 'quality',
        'Strength': 'strength',
        'Speed': 'speed',
        'Support': 'support',
        'Multimaterial': 'multi_material',
        'Others': 'other',
    }

    def __init__(self, cpp_file_path: str, tab_cpp_path: Optional[str] = None):
        self.cpp_file_path = Path(cpp_file_path)
        # Tab.cpp lives alongside PrintConfig.cpp's sibling GUI directory:
        # src/libslic3r/PrintConfig.cpp -> src/slic3r/GUI/Tab.cpp
        if tab_cpp_path is None:
            src_dir = self.cpp_file_path.parent.parent  # .../src
            tab_cpp_path = src_dir / "slic3r" / "GUI" / "Tab.cpp"
        self.tab_cpp_path = Path(tab_cpp_path)
        self.parameters: Dict[str, Dict[str, Any]] = {}

    def parse(self) -> Dict[str, Dict[str, Any]]:
        """Parse the PrintConfig.cpp file and extract all parameter definitions"""

        if not self.cpp_file_path.exists():
            raise FileNotFoundError(f"PrintConfig.cpp not found at {self.cpp_file_path}")

        content = self.cpp_file_path.read_text(encoding='utf-8', errors='ignore')

        # Find all parameter definitions
        # Pattern: def = this->add("param_name", coType);
        param_start_pattern = r'def\s*=\s*this->add\s*\(\s*"([^"]+)"\s*,\s*(\w+)\s*\);'

        matches = list(re.finditer(param_start_pattern, content))

        # Parse the native UI's page/group/order structure from Tab.cpp.
        # This is the ground truth for how Process settings are organised
        # in the OrcaSlicer desktop app.
        tab_structure = self._parse_tab_structure()

        for i, match in enumerate(matches):
            param_key = match.group(1)
            param_type = match.group(2)
            start_pos = match.end()

            # Find the end of this parameter definition (next def = or end of function)
            if i + 1 < len(matches):
                end_pos = matches[i + 1].start()
            else:
                # Last parameter, find end of function
                end_pos = content.find('\n}', start_pos)
                if end_pos == -1:
                    end_pos = len(content)

            param_block = content[start_pos:end_pos]

            # Extract parameter attributes
            param_info = self._extract_param_info(param_key, param_type, param_block)

            if param_info:
                # Override section/group/order with the native UI structure
                # when this parameter is part of the Process (TabPrint) tab.
                tab_entry = tab_structure.get(param_key)
                if tab_entry:
                    param_info['section'] = tab_entry['section']
                    param_info['group'] = tab_entry['group']
                    param_info['group_order'] = tab_entry['group_order']
                    param_info['order'] = tab_entry['order']
                else:
                    param_info['group'] = None
                    param_info['group_order'] = None
                    param_info['order'] = None

                self.parameters[param_key] = param_info

        # Copy enum values for parameters that reference another parameter's list
        self._copy_enum_values_from_reference(self.parameters)

        return self.parameters

    # ------------------------------------------------------------------
    # Native UI structure extraction (Tab.cpp)
    # ------------------------------------------------------------------

    def _parse_tab_structure(self) -> Dict[str, Dict[str, Any]]:
        """
        Parse `TabPrint::build()` in Tab.cpp to recover the exact page
        (section) / optgroup (group) / order that the native OrcaSlicer
        desktop UI uses for Process settings.

        Returns a dict keyed by parameter key with 'section', 'group',
        and 'order' (int, position within its group) entries. Returns an
        empty dict if Tab.cpp cannot be found or parsed (parsing then
        falls back to category-based sectioning for every parameter).
        """
        if not self.tab_cpp_path.exists():
            return {}

        content = self.tab_cpp_path.read_text(encoding='utf-8', errors='ignore')

        start = content.find('void TabPrint::build()')
        if start == -1:
            return {}
        end = content.find('void TabPrint::reload_config()', start)
        if end == -1:
            end = start + 50000  # generous fallback window
        body = content[start:end]

        result: Dict[str, Dict[str, Any]] = {}

        current_page: Optional[str] = None
        current_group: Optional[str] = None
        group_index = -1   # position of the current group within its page (appearance order)
        order = 0          # position of the option within its group
        last_get_option_key: Optional[str] = None

        re_page = re.compile(r'add_options_page\(L\("([^"]+)"')
        re_group = re.compile(r'new_optgroup\(L\("([^"]+)"')
        re_simple = re.compile(r'append_single_option_line\(\s*"([^"]+)"')
        re_option_var = re.compile(r'append_single_option_line\(\s*option\b')
        re_get_option = re.compile(r'get_option\(\s*"([^"]+)"')
        re_append_option = re.compile(r'\.append_option\(')

        def record(key: str) -> None:
            nonlocal order
            section = self.PAGE_TO_SECTION.get(current_page or "")
            if section and current_group:
                result[key] = {
                    'section': section,
                    'group': current_group,
                    'group_order': group_index,
                    'order': order,
                }
                order += 1

        for raw_line in body.splitlines():
            line = raw_line.strip()
            if not line or line.startswith('//'):
                continue

            m = re_page.search(line)
            if m:
                current_page = m.group(1)
                current_group = None
                group_index = -1
                continue

            m = re_group.search(line)
            if m:
                current_group = m.group(1)
                group_index += 1
                order = 0
                continue

            # optgroup->append_single_option_line("key", ...)
            simple_matches = list(re_simple.finditer(line))
            if simple_matches:
                for m in simple_matches:
                    record(m.group(1))
                continue

            # line.append_option(optgroup->get_option("key", idx))
            if re_append_option.search(line):
                for m in re_get_option.finditer(line):
                    record(m.group(1))
                continue

            # option = optgroup->get_option("key"); (deferred registration)
            m = re_get_option.search(line)
            if m:
                last_get_option_key = m.group(1)
                continue

            # optgroup->append_single_option_line(option, "path");
            if re_option_var.search(line) and last_get_option_key:
                record(last_get_option_key)
                last_get_option_key = None

        return result

    # ------------------------------------------------------------------
    # Parameter attribute extraction (PrintConfig.cpp)
    # ------------------------------------------------------------------

    def _extract_param_info(self, key: str, cpp_type: str, block: str) -> Optional[Dict[str, Any]]:
        """Extract parameter information from a definition block"""

        param_type = self.TYPE_MAPPING.get(cpp_type, 'string')

        # Extract label (may be wrapped in L(...) or be a bare string literal,
        # and may be composed of multiple adjacent quoted segments)
        label = self._extract_concatenated_string(block, r'def->label\s*=\s*(?:L\()?((?:\s*"[^"]*"\s*)+)\)?;')
        if not label:
            # Skip parameters without labels (internal parameters)
            return None

        # Extract tooltip (also may span multiple concatenated string literals)
        tooltip = self._extract_concatenated_string(block, r'def->tooltip\s*=\s*(?:L\()?((?:\s*"[^"]*"\s*)+)\)?;')
        if not tooltip:
            tooltip = ""

        # Extract category
        category = self._extract_string_value(block, r'def->category\s*=\s*L\s*\(\s*"([^"]+)"\s*\)')
        section = self.CATEGORY_TO_SECTION.get(category, 'other')

        # Extract sidetext (unit, e.g. "mm", "mm or %", "%", "°")
        unit = self._extract_string_value(
            block, r'def->sidetext\s*=\s*(?:u8)?(?:L\()?"([^"]*)"'
        )

        # Extract default value (generic, based on the set_default_value(...) call)
        default_value = self._extract_default_value(block, param_type)

        # Extract min/max for numeric types
        min_val = None
        max_val = None
        if param_type in ['float', 'int']:
            min_val = self._extract_numeric_constraint(block, 'min')
            max_val = self._extract_numeric_constraint(block, 'max')

        # Extract enum values
        enum_values = None
        if param_type == 'enum':
            enum_values = self._extract_enum_values(block)
            if default_value in (None, "") and enum_values:
                default_value = enum_values[0]

        return {
            'key': key,
            'label': label,
            'tooltip': tooltip,
            'type': param_type,
            'default_value': default_value,
            'min': min_val,
            'max': max_val,
            'enum_values': enum_values,
            'unit': unit,
            'section': section,
        }

    def _extract_string_value(self, block: str, pattern: str) -> Optional[str]:
        """Extract a string value using a regex pattern"""
        match = re.search(pattern, block, re.DOTALL)
        if match:
            # Clean up the string: unescape quotes, handle line continuations
            value = match.group(1)
            value = value.replace('\\"', '"')
            value = re.sub(r'\s+', ' ', value)  # Normalize whitespace
            return value.strip()
        return None

    def _extract_concatenated_string(self, block: str, pattern: str) -> Optional[str]:
        """
        Extract a string value that may be composed of several adjacent
        C++ string literals (implicit concatenation), e.g.:

            def->tooltip = L("Part one. "
                              "Part two.");

        Returns the concatenation of all quoted segments, or None if the
        pattern does not match.
        """
        match = re.search(pattern, block, re.DOTALL)
        if not match:
            return None
        segments = re.findall(r'"([^"]*)"', match.group(1))
        if not segments:
            return None
        value = ''.join(segments)
        value = value.replace('\\"', '"')
        value = re.sub(r'\s+', ' ', value)
        return value.strip()

    def _extract_default_value(self, block: str, param_type: str) -> Any:
        """
        Extract the default value for a parameter from its
        `set_default_value(...)` call.

        Handles scalar and per-extruder-array config option constructors
        (ConfigOptionFloat/Floats/FloatsNullable/Percent/Percents/
        FloatOrPercent/FloatsOrPercents(Nullable)/Int/Ints/Bool/Bools/
        String/Strings) generically by taking the first literal of the
        appropriate kind found inside the constructor call.
        """
        set_default_match = re.search(r'set_default_value\((.*?)\);', block, re.DOTALL)
        if not set_default_match:
            return self._type_zero_value(param_type)

        default_block = set_default_match.group(1)

        if param_type == 'bool':
            m = re.search(r'\b(true|false)\b', default_block)
            return (m.group(1) == 'true') if m else False

        if param_type == 'string':
            m = re.search(r'"([^"]*)"', default_block)
            return m.group(1) if m else ""

        if param_type == 'int':
            m = re.search(r'(-?\d+)\b', default_block)
            return int(m.group(1)) if m else 0

        if param_type == 'float':
            m = re.search(r'(-?\d+\.\d+|-?\d+)f?\b', default_block)
            if m:
                return float(m.group(1))
            return 0.0

        # enum or unknown: leave to caller (enum default resolved via enum_values)
        return self._type_zero_value(param_type)

    @staticmethod
    def _type_zero_value(param_type: str) -> Any:
        return {
            'bool': False,
            'int': 0,
            'float': 0.0,
            'string': "",
            'enum': "",
        }.get(param_type, "")

    def _extract_numeric_constraint(self, block: str, constraint: str) -> Optional[float]:
        """Extract min or max constraint"""
        pattern = rf'def->{constraint}\s*=\s*(-?\d+\.?\d*)f?\s*;'
        match = re.search(pattern, block)
        if match:
            return float(match.group(1))
        return None

    def _extract_enum_values(self, block: str) -> Optional[List[str]]:
        """Extract enum values from the definition block"""

        # Pattern 1: push_back / emplace_back with individual string literals
        enum_values = []
        pattern_individual = r'def->enum_values\.(?:push_back|emplace_back)\s*\(\s*"([^"]+)"\s*\)'
        for match in re.finditer(pattern_individual, block):
            enum_values.append(match.group(1))
        if enum_values:
            return enum_values

        # Pattern 2: brace-initializer list  = {"val1", "val2", ...}
        # e.g. def->enum_values  = {"Default", "MZV", "ZV", ...};
        brace_match = re.search(r'def->enum_values\s*=\s*\{([^}]+)\}', block)
        if brace_match:
            inner = brace_match.group(1)
            enum_values = [m.group(1) for m in re.finditer(r'"([^"]+)"', inner)]
            if enum_values:
                return enum_values

        return None

    def _copy_enum_values_from_reference(self, parameters: Dict[str, Dict[str, Any]]) -> None:
        """
        Some parameters copy their enum_values from another parameter using
        assignment:  def->enum_values = other_def->enum_values;
        We handle the known cases by copying from the reference parameter
        after all parameters have been parsed.
        """
        # Known pattern in PrintConfig.cpp:
        #   bottom_surface_pattern and internal_solid_infill_pattern copy
        #   from top_surface_pattern (stored as def_top_fill_pattern).
        COPY_FROM = {
            'bottom_surface_pattern':       'top_surface_pattern',
            'internal_solid_infill_pattern': 'top_surface_pattern',
        }
        for dest_key, src_key in COPY_FROM.items():
            if dest_key in parameters and src_key in parameters:
                if not parameters[dest_key].get('enum_values'):
                    parameters[dest_key]['enum_values'] = parameters[src_key].get('enum_values')
                    if not parameters[dest_key].get('default_value'):
                        evs = parameters[dest_key]['enum_values']
                        if evs:
                            parameters[dest_key]['default_value'] = evs[0]

    def save_to_json(self, output_path: str) -> None:
        """Save the extracted parameters to a JSON file, ordered to match
        the native UI: grouped parameters first (by section, then group,
        then order), followed by any ungrouped parameters."""

        # Fixed page ordering matches TabPrint::build(): Quality, Strength,
        # Speed, Support, Multimaterial, Others.
        section_order = {
            'quality': 0,
            'strength': 1,
            'speed': 2,
            'support': 3,
            'multi_material': 4,
            'other': 5,
        }

        def sort_key(param: Dict[str, Any]):
            has_group = param.get('group') is not None
            return (
                0 if has_group else 1,
                section_order.get(param.get('section'), 99),
                param.get('group_order') if param.get('group_order') is not None else 0,
                param.get('order') if param.get('order') is not None else 0,
                param['key'],
            )

        param_list = sorted(self.parameters.values(), key=sort_key)

        output_file = Path(output_path)
        output_file.parent.mkdir(parents=True, exist_ok=True)

        with output_file.open('w', encoding='utf-8') as f:
            json.dump(param_list, f, indent=2, ensure_ascii=False)

        print(f"Extracted {len(param_list)} parameters to {output_path}")


def main():
    """Main entry point for the parameter parser"""

    # Paths relative to the backend directory
    script_dir = Path(__file__).parent
    backend_dir = script_dir.parent
    workspace_root = backend_dir.parent.parent

    cpp_file = workspace_root / "OrcaSlicer" / "src" / "libslic3r" / "PrintConfig.cpp"
    output_file = script_dir / "data" / "parameters.json"

    print(f"Parsing PrintConfig.cpp from: {cpp_file}")
    print(f"Output will be written to: {output_file}")

    parser = ParameterParser(str(cpp_file))
    parameters = parser.parse()
    parser.save_to_json(str(output_file))

    grouped = sum(1 for p in parameters.values() if p.get('group'))
    print(f"\n{grouped}/{len(parameters)} parameters matched to a native UI group")

    print(f"\nSample parameters:")
    for i, (key, param) in enumerate(list(parameters.items())[:5]):
        print(f"  {key}: {param['label']} ({param['type']}) group={param.get('group')}")
        if i >= 4:
            break


if __name__ == '__main__':
    main()
