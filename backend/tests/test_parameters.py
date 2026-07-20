"""
Test suite for parameters API endpoint.

Tests GET /api/parameters endpoint functionality.

Requirements validated: 3.1, 11.4
"""

import os
import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    """Create a test client with proper configuration."""
    # Set environment variables
    os.environ['API_SECRET'] = 'test-secret-key-12345'
    os.environ['ORCA_CLI_PATH'] = '/home/odin/local/orcaslicerWebUI/OrcaSlicer/build/linux/release/OrcaSlicer_ubu64'
    
    # Import after setting env vars
    from app.main import app
    from app.auth import init_auth
    
    # Initialize auth
    init_auth('test-secret-key-12345')
    
    return TestClient(app)


@pytest.fixture
def auth_headers():
    """Valid authentication headers."""
    return {'Authorization': 'Bearer test-secret-key-12345'}


def test_parameters_requires_auth(client):
    """
    Test that the parameters endpoint requires authentication.
    
    Validates: Requirements 11.5 (authentication required)
    """
    response = client.get('/api/parameters')
    assert response.status_code == 401, "Expected 401 Unauthorized without auth token"


def test_parameters_rejects_invalid_token(client):
    """
    Test that the parameters endpoint rejects invalid tokens.
    
    Validates: Requirements 11.5 (token validation)
    """
    headers = {'Authorization': 'Bearer invalid-token'}
    response = client.get('/api/parameters', headers=headers)
    assert response.status_code == 401, "Expected 401 Unauthorized with invalid token"


def test_parameters_returns_list(client, auth_headers):
    """
    Test that the parameters endpoint returns a list of parameter descriptors.
    
    Validates: Requirements 3.1
    """
    response = client.get('/api/parameters', headers=auth_headers)
    assert response.status_code == 200, f"Expected 200 OK, got {response.status_code}: {response.text}"
    
    parameters = response.json()
    assert isinstance(parameters, list), "Response should be a list"
    assert len(parameters) > 0, "Should return at least one parameter descriptor"


def test_parameter_descriptor_structure(client, auth_headers):
    """
    Test that parameter descriptors have the expected structure.
    
    Validates: Requirements 3.1
    """
    response = client.get('/api/parameters', headers=auth_headers)
    assert response.status_code == 200
    
    parameters = response.json()
    
    # Check first parameter has all required fields
    first_param = parameters[0]
    required_fields = ['key', 'label', 'tooltip', 'type', 'default_value', 'section']
    for field in required_fields:
        assert field in first_param, f"Parameter descriptor missing required field: {field}"
    
    # Check type is one of the expected values
    assert first_param['type'] in ['float', 'int', 'bool', 'enum', 'string'], \
        f"Unexpected parameter type: {first_param['type']}"
    
    # Check section is one of the expected values
    assert first_param['section'] in ['quality', 'strength', 'speed', 'support', 'multi_material', 'gcode', 'other'], \
        f"Unexpected parameter section: {first_param['section']}"


def test_known_parameters_present(client, auth_headers):
    """
    Test that known parameters from PrintConfig.cpp are present.
    
    Validates: Requirements 3.1
    """
    response = client.get('/api/parameters', headers=auth_headers)
    assert response.status_code == 200
    
    parameters = response.json()
    param_keys = [p['key'] for p in parameters]
    
    # Check for some known parameters that should exist
    expected_params = ['layer_height', 'sparse_infill_density', 'sparse_infill_speed']
    for expected in expected_params:
        assert expected in param_keys, f"Expected parameter '{expected}' not found in parameter list"


def test_param_allowlist_is_built():
    """
    Test that the PARAM_ALLOWLIST frozenset is built at module load time.
    
    Validates: Requirements 11.4
    """
    from app.routers.parameters import get_param_allowlist
    
    allowlist = get_param_allowlist()
    assert isinstance(allowlist, frozenset), "PARAM_ALLOWLIST should be a frozenset"
    assert len(allowlist) > 0, "PARAM_ALLOWLIST should not be empty"
    
    # Check that some known parameters are in the allowlist
    assert 'layer_height' in allowlist, "layer_height should be in allowlist"
    assert 'sparse_infill_density' in allowlist, "sparse_infill_density should be in allowlist"


def test_numeric_parameter_has_min_max(client, auth_headers):
    """
    Test that numeric parameters have min and max values.
    
    Validates: Requirements 3.1
    """
    response = client.get('/api/parameters', headers=auth_headers)
    assert response.status_code == 200
    
    parameters = response.json()
    
    # Find a numeric parameter (float or int)
    numeric_params = [p for p in parameters if p['type'] in ['float', 'int']]
    assert len(numeric_params) > 0, "Should have at least one numeric parameter"
    
    # Check that numeric parameters have min/max fields (even if null)
    for param in numeric_params[:5]:  # Check first 5 numeric parameters
        assert 'min' in param, f"Numeric parameter {param['key']} should have 'min' field"
        assert 'max' in param, f"Numeric parameter {param['key']} should have 'max' field"


def test_enum_parameter_has_enum_values(client, auth_headers):
    """
    Test that enum parameters have enum_values list.
    
    Validates: Requirements 3.1
    """
    response = client.get('/api/parameters', headers=auth_headers)
    assert response.status_code == 200
    
    parameters = response.json()
    
    # Find an enum parameter
    enum_params = [p for p in parameters if p['type'] == 'enum']
    
    if len(enum_params) > 0:
        # Check that enum parameters have enum_values field with a list
        for param in enum_params[:3]:  # Check first 3 enum parameters
            assert 'enum_values' in param, f"Enum parameter {param['key']} should have 'enum_values' field"
            if param['enum_values'] is not None:
                assert isinstance(param['enum_values'], list), \
                    f"Enum parameter {param['key']} enum_values should be a list"
                assert len(param['enum_values']) > 0, \
                    f"Enum parameter {param['key']} enum_values should not be empty"
