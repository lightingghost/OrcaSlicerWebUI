"""
Unit tests for the parameter parser.

Tests the ParameterParser class that extracts parameter definitions from
PrintConfig.cpp and generates the parameters.json snapshot.

Task: 5.3 - Write unit tests for parameter parser
Requirements validated: 3.1
"""

import json
import pytest
from pathlib import Path
from app.parameter_parser import ParameterParser


@pytest.fixture
def parser():
    """Create a ParameterParser instance with the actual PrintConfig.cpp file."""
    backend_dir = Path(__file__).parent.parent
    workspace_root = backend_dir.parent.parent
    cpp_file = workspace_root / "OrcaSlicer" / "src" / "libslic3r" / "PrintConfig.cpp"
    
    if not cpp_file.exists():
        pytest.skip(f"PrintConfig.cpp not found at {cpp_file}")
    
    return ParameterParser(str(cpp_file))


@pytest.fixture
def parsed_parameters(parser):
    """Parse parameters once for all tests to avoid repeated parsing."""
    return parser.parse()


@pytest.fixture
def parameters_json():
    """Load the pre-generated parameters.json file."""
    data_dir = Path(__file__).parent.parent / "app" / "data"
    params_file = data_dir / "parameters.json"
    
    if not params_file.exists():
        pytest.skip(f"parameters.json not found at {params_file}")
    
    with params_file.open("r", encoding="utf-8") as f:
        return json.load(f)


class TestParameterParserBasics:
    """Test basic functionality of the ParameterParser class."""
    
    def test_parser_initialization(self):
        """Test that parser can be initialized with a file path."""
        backend_dir = Path(__file__).parent.parent
        workspace_root = backend_dir.parent.parent
        cpp_file = workspace_root / "OrcaSlicer" / "src" / "libslic3r" / "PrintConfig.cpp"
        
        parser = ParameterParser(str(cpp_file))
        assert parser.cpp_file_path == cpp_file
        assert isinstance(parser.parameters, dict)
    
    def test_parser_missing_file(self):
        """Test that parser raises FileNotFoundError for missing file."""
        parser = ParameterParser("/nonexistent/file.cpp")
        
        with pytest.raises(FileNotFoundError):
            parser.parse()
    
    def test_parse_returns_dict(self, parser):
        """Test that parse() returns a dictionary of parameters."""
        parameters = parser.parse()
        
        assert isinstance(parameters, dict)
        assert len(parameters) > 0, "Should parse at least one parameter"
    
    def test_parsed_parameters_have_keys(self, parsed_parameters):
        """Test that parsed parameters use parameter keys as dict keys."""
        assert len(parsed_parameters) > 0
        
        # All keys should be strings
        for key in parsed_parameters.keys():
            assert isinstance(key, str)
            assert len(key) > 0


class TestKnownParameters:
    """Test that known parameters from PrintConfig.cpp appear in output."""
    
    KNOWN_PARAMETERS = {
        'layer_height': {
            'type': 'float',
            'has_label': True,
            'has_min': True,
            'has_max': False,  # layer_height has min but not max
        },
        'sparse_infill_density': {
            'type': 'float',
            'has_label': True,
            'has_min': True,
            'has_max': True,
        },
        'sparse_infill_speed': {
            'type': 'float',
            'has_label': True,
            'has_min': True,
            'has_max': False,  # May or may not have max
        },
        'enable_support': {
            'type': 'bool',
            'has_label': True,
            'has_min': False,
            'has_max': False,
        },
        'wall_loops': {
            'type': 'int',
            'has_label': True,
            'has_min': True,
            'has_max': False,
        },
    }
    
    def test_known_parameters_present(self, parsed_parameters):
        """Test that known parameters are present in parsed output."""
        param_keys = set(parsed_parameters.keys())
        
        for known_key in self.KNOWN_PARAMETERS.keys():
            assert known_key in param_keys, \
                f"Known parameter '{known_key}' not found in parsed parameters"
    
    def test_known_parameters_have_correct_types(self, parsed_parameters):
        """Test that known parameters have correct types."""
        for key, expected in self.KNOWN_PARAMETERS.items():
            if key in parsed_parameters:
                param = parsed_parameters[key]
                assert param['type'] == expected['type'], \
                    f"Parameter '{key}' has type '{param['type']}', expected '{expected['type']}'"
    
    def test_known_parameters_have_labels(self, parsed_parameters):
        """Test that known parameters have non-empty labels."""
        for key in self.KNOWN_PARAMETERS.keys():
            if key in parsed_parameters:
                param = parsed_parameters[key]
                assert 'label' in param
                assert isinstance(param['label'], str)
                assert len(param['label']) > 0, \
                    f"Parameter '{key}' has empty label"
    
    def test_known_numeric_parameters_have_constraints(self, parsed_parameters):
        """Test that known numeric parameters have min/max constraints where expected."""
        for key, expected in self.KNOWN_PARAMETERS.items():
            if key in parsed_parameters:
                param = parsed_parameters[key]
                
                if param['type'] in ['float', 'int']:
                    # Check min constraint
                    if expected.get('has_min'):
                        assert param.get('min') is not None, \
                            f"Numeric parameter '{key}' should have min constraint"
                    
                    # Check max constraint
                    if expected.get('has_max'):
                        assert param.get('max') is not None, \
                            f"Numeric parameter '{key}' should have max constraint"


class TestParameterStructure:
    """Test that all parsed parameters have correct structure."""
    
    REQUIRED_FIELDS = ['key', 'label', 'tooltip', 'type', 'default_value', 'section']
    OPTIONAL_FIELDS = ['min', 'max', 'enum_values']
    VALID_TYPES = ['float', 'int', 'bool', 'enum', 'string']
    VALID_SECTIONS = ['quality', 'strength', 'speed', 'support', 'multi_material', 'gcode', 'other']
    
    def test_all_parameters_have_required_fields(self, parsed_parameters):
        """Test that all parameters have required fields."""
        for key, param in parsed_parameters.items():
            for field in self.REQUIRED_FIELDS:
                assert field in param, \
                    f"Parameter '{key}' missing required field '{field}'"
    
    def test_all_parameters_have_valid_types(self, parsed_parameters):
        """Test that all parameters have valid type values."""
        for key, param in parsed_parameters.items():
            assert param['type'] in self.VALID_TYPES, \
                f"Parameter '{key}' has invalid type '{param['type']}'"
    
    def test_all_parameters_have_valid_sections(self, parsed_parameters):
        """Test that all parameters have valid section values."""
        for key, param in parsed_parameters.items():
            assert param['section'] in self.VALID_SECTIONS, \
                f"Parameter '{key}' has invalid section '{param['section']}'"
    
    def test_parameter_keys_match(self, parsed_parameters):
        """Test that parameter 'key' field matches dictionary key."""
        for dict_key, param in parsed_parameters.items():
            assert param['key'] == dict_key, \
                f"Parameter dict key '{dict_key}' doesn't match param key '{param['key']}'"
    
    def test_numeric_parameters_have_numeric_defaults(self, parsed_parameters):
        """Test that numeric parameters have numeric default values."""
        for key, param in parsed_parameters.items():
            if param['type'] == 'float':
                assert isinstance(param['default_value'], (int, float)), \
                    f"Float parameter '{key}' has non-numeric default: {param['default_value']}"
            
            elif param['type'] == 'int':
                assert isinstance(param['default_value'], int), \
                    f"Int parameter '{key}' has non-integer default: {param['default_value']}"
    
    def test_bool_parameters_have_bool_defaults(self, parsed_parameters):
        """Test that boolean parameters have boolean default values."""
        for key, param in parsed_parameters.items():
            if param['type'] == 'bool':
                assert isinstance(param['default_value'], bool), \
                    f"Bool parameter '{key}' has non-boolean default: {param['default_value']}"
    
    def test_string_parameters_have_string_defaults(self, parsed_parameters):
        """Test that string parameters have string default values."""
        for key, param in parsed_parameters.items():
            if param['type'] == 'string':
                assert isinstance(param['default_value'], str), \
                    f"String parameter '{key}' has non-string default: {param['default_value']}"
    
    def test_enum_parameters_have_enum_values_list(self, parsed_parameters):
        """Test that enum parameters have enum_values field."""
        for key, param in parsed_parameters.items():
            if param['type'] == 'enum':
                assert 'enum_values' in param
                # enum_values can be None or a list
                if param['enum_values'] is not None:
                    assert isinstance(param['enum_values'], list), \
                        f"Enum parameter '{key}' enum_values is not a list"


class TestParameterConstraints:
    """Test parameter constraint extraction."""
    
    def test_numeric_constraints_are_numeric(self, parsed_parameters):
        """Test that min/max constraints are numeric when present."""
        for key, param in parsed_parameters.items():
            if param['type'] in ['float', 'int']:
                if param.get('min') is not None:
                    assert isinstance(param['min'], (int, float)), \
                        f"Parameter '{key}' min constraint is not numeric: {param['min']}"
                
                if param.get('max') is not None:
                    assert isinstance(param['max'], (int, float)), \
                        f"Parameter '{key}' max constraint is not numeric: {param['max']}"
    
    def test_min_less_than_max_when_both_present(self, parsed_parameters):
        """Test that min < max when both constraints are present."""
        for key, param in parsed_parameters.items():
            if param['type'] in ['float', 'int']:
                min_val = param.get('min')
                max_val = param.get('max')
                
                if min_val is not None and max_val is not None:
                    assert min_val < max_val, \
                        f"Parameter '{key}' has min >= max: min={min_val}, max={max_val}"
    
    def test_default_within_constraints_when_present(self, parsed_parameters):
        """Test that default value is within min/max constraints when present.
        
        Note: Some parameters may have default values of 0 that are outside
        min constraints - these serve as "disabled" or "auto" values.
        """
        violations = []
        
        for key, param in parsed_parameters.items():
            if param['type'] in ['float', 'int']:
                default = param['default_value']
                min_val = param.get('min')
                max_val = param.get('max')
                
                if isinstance(default, (int, float)):
                    # Skip 0 defaults as they often mean "disabled" or "auto"
                    if default == 0:
                        continue
                    
                    if min_val is not None and default < min_val:
                        violations.append(
                            f"Parameter '{key}' default {default} < min {min_val}"
                        )
                    
                    if max_val is not None and default > max_val:
                        violations.append(
                            f"Parameter '{key}' default {default} > max {max_val}"
                        )
        
        # Allow a small number of violations (< 5% of numeric params)
        numeric_params = sum(1 for p in parsed_parameters.values() if p['type'] in ['float', 'int'])
        max_violations = max(1, int(numeric_params * 0.05))
        
        assert len(violations) <= max_violations, \
            f"Too many default value constraint violations:\n" + "\n".join(violations[:10])


class TestParametersJsonConsistency:
    """Test consistency between parser output and parameters.json file."""
    
    def test_json_file_has_same_keys(self, parsed_parameters, parameters_json):
        """Test that parameters.json has the same parameter keys."""
        parsed_keys = set(parsed_parameters.keys())
        json_keys = {p['key'] for p in parameters_json}
        
        # Allow some difference since the file may be regenerated
        # but most keys should match
        common_keys = parsed_keys & json_keys
        assert len(common_keys) >= len(parsed_keys) * 0.9, \
            "parameters.json should have at least 90% of parsed parameter keys"
    
    def test_json_parameters_have_correct_structure(self, parameters_json):
        """Test that parameters.json entries have correct structure."""
        required_fields = ['key', 'label', 'tooltip', 'type', 'default_value', 'section']
        
        for param in parameters_json[:10]:  # Check first 10
            for field in required_fields:
                assert field in param, \
                    f"Parameter {param.get('key', 'unknown')} missing field '{field}'"
    
    def test_json_known_parameters_match_parsed(self, parsed_parameters, parameters_json):
        """Test that known parameters in JSON match parsed values."""
        json_dict = {p['key']: p for p in parameters_json}
        
        known_keys = ['layer_height', 'sparse_infill_density']
        
        for key in known_keys:
            if key in parsed_parameters and key in json_dict:
                parsed_param = parsed_parameters[key]
                json_param = json_dict[key]
                
                assert parsed_param['type'] == json_param['type'], \
                    f"Type mismatch for '{key}'"
                assert parsed_param['section'] == json_param['section'], \
                    f"Section mismatch for '{key}'"


class TestTypeMapping:
    """Test C++ type to API type mapping."""
    
    def test_type_mapping_is_defined(self):
        """Test that TYPE_MAPPING is properly defined."""
        from app.parameter_parser import ParameterParser
        
        assert hasattr(ParameterParser, 'TYPE_MAPPING')
        assert isinstance(ParameterParser.TYPE_MAPPING, dict)
        assert len(ParameterParser.TYPE_MAPPING) > 0
    
    def test_all_mapped_types_are_valid(self):
        """Test that all mapped types are valid API types."""
        from app.parameter_parser import ParameterParser
        
        valid_types = {'float', 'int', 'bool', 'enum', 'string'}
        
        for cpp_type, api_type in ParameterParser.TYPE_MAPPING.items():
            assert api_type in valid_types, \
                f"C++ type '{cpp_type}' maps to invalid API type '{api_type}'"
    
    def test_common_cpp_types_are_mapped(self):
        """Test that common C++ config types are mapped."""
        from app.parameter_parser import ParameterParser
        
        expected_types = ['coFloat', 'coInt', 'coBool', 'coString', 'coEnum', 'coPercent']
        
        for cpp_type in expected_types:
            assert cpp_type in ParameterParser.TYPE_MAPPING, \
                f"Expected C++ type '{cpp_type}' not in TYPE_MAPPING"


class TestCategoryMapping:
    """Test category to section mapping."""
    
    def test_category_mapping_is_defined(self):
        """Test that CATEGORY_TO_SECTION is properly defined."""
        from app.parameter_parser import ParameterParser
        
        assert hasattr(ParameterParser, 'CATEGORY_TO_SECTION')
        assert isinstance(ParameterParser.CATEGORY_TO_SECTION, dict)
    
    def test_all_mapped_sections_are_valid(self):
        """Test that all mapped sections are valid."""
        from app.parameter_parser import ParameterParser
        
        valid_sections = {'quality', 'strength', 'speed', 'support', 'multi_material', 'gcode', 'other'}
        
        for category, section in ParameterParser.CATEGORY_TO_SECTION.items():
            assert section in valid_sections, \
                f"Category '{category}' maps to invalid section '{section}'"
    
    def test_common_categories_are_mapped(self):
        """Test that common categories are mapped."""
        from app.parameter_parser import ParameterParser
        
        expected_categories = ['Quality', 'Strength', 'Speed', 'Support']
        
        for category in expected_categories:
            assert category in ParameterParser.CATEGORY_TO_SECTION, \
                f"Expected category '{category}' not in CATEGORY_TO_SECTION"


class TestParserStatistics:
    """Test overall parser statistics and coverage."""
    
    def test_parser_finds_sufficient_parameters(self, parsed_parameters):
        """Test that parser finds a reasonable number of parameters."""
        # PrintConfig.cpp should have hundreds of parameters
        assert len(parsed_parameters) >= 100, \
            f"Parser only found {len(parsed_parameters)} parameters, expected at least 100"
    
    def test_parser_finds_all_types(self, parsed_parameters):
        """Test that parser finds parameters of all types."""
        types_found = {param['type'] for param in parsed_parameters.values()}
        
        # Should have at least float, int, bool, string
        expected_types = {'float', 'int', 'bool', 'string'}
        assert expected_types.issubset(types_found), \
            f"Parser should find all basic types. Found: {types_found}"
    
    def test_parser_categorizes_parameters(self, parsed_parameters):
        """Test that parameters are distributed across sections."""
        sections_found = {param['section'] for param in parsed_parameters.values()}
        
        # Should have multiple sections (not just 'other')
        assert len(sections_found) > 1, \
            f"Parser should categorize parameters into multiple sections. Found: {sections_found}"
    
    def test_most_parameters_have_tooltips(self, parsed_parameters):
        """Test that most parameters have tooltip documentation."""
        params_with_tooltips = sum(
            1 for param in parsed_parameters.values()
            if param['tooltip'] and len(param['tooltip']) > 0
        )
        
        # At least 50% should have tooltips
        assert params_with_tooltips >= len(parsed_parameters) * 0.5, \
            f"Only {params_with_tooltips}/{len(parsed_parameters)} parameters have tooltips"


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
