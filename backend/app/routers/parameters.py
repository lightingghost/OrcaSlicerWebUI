"""
Parameter schema API routes.

This module implements endpoints for retrieving the full list of configurable
parameters defined in PrintConfig.cpp. It loads a pre-generated snapshot and
builds the PARAM_ALLOWLIST frozenset at startup for validation.

Requirements: 3.1, 11.4
"""

import json
from pathlib import Path
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import verify_token


router = APIRouter(dependencies=[Depends(verify_token)])


class ParameterDescriptor(BaseModel):
    """
    Descriptor for a single configurable parameter.
    
    Attributes:
        key: Parameter key used in CLI (e.g., "layer_height")
        label: Human-readable label for display
        tooltip: Descriptive tooltip/help text
        type: Parameter value type (float, int, bool, enum, string)
        default_value: Default value for this parameter
        min: Minimum allowed value (numeric types only)
        max: Maximum allowed value (numeric types only)
        enum_values: List of allowed values (enum type only)
        section: UI grouping section for organization
    """
    key: str
    label: str
    tooltip: str
    type: Literal["float", "int", "bool", "enum", "string"]
    default_value: str | int | float | bool
    min: Optional[float] = None
    max: Optional[float] = None
    enum_values: Optional[List[str]] = None
    section: Literal["quality", "strength", "speed", "support", "multi_material", "gcode", "other"]
    group: Optional[str] = None
    group_order: Optional[int] = None
    order: Optional[int] = None
    unit: Optional[str] = None


# Module-level cache for parameters and allowlist
# Built at startup when the module is imported
_PARAMETERS_CACHE: List[ParameterDescriptor] = []
_PARAM_ALLOWLIST: frozenset[str] = frozenset()


def _load_parameters() -> List[ParameterDescriptor]:
    """
    Load parameter descriptors from the pre-generated parameters.json snapshot.
    
    This function is called once at module initialization to populate the cache.
    
    Returns:
        List[ParameterDescriptor]: List of all parameter descriptors
        
    Raises:
        RuntimeError: If parameters.json cannot be found or parsed
    """
    # Locate parameters.json relative to this module
    data_dir = Path(__file__).parent.parent / "data"
    params_file = data_dir / "parameters.json"
    
    if not params_file.exists():
        raise RuntimeError(
            f"parameters.json not found at {params_file}. "
            "Run parameter_parser.py to generate it."
        )
    
    try:
        with params_file.open("r", encoding="utf-8") as f:
            params_data = json.load(f)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Failed to parse parameters.json: {e}")
    except Exception as e:
        raise RuntimeError(f"Failed to read parameters.json: {e}")
    
    # Validate and convert to ParameterDescriptor objects
    descriptors = []
    for item in params_data:
        try:
            descriptor = ParameterDescriptor(**item)
            descriptors.append(descriptor)
        except Exception as e:
            # Log warning but continue - don't fail startup for one bad entry
            print(f"Warning: Failed to parse parameter descriptor {item.get('key', 'unknown')}: {e}")
            continue
    
    return descriptors


def _build_param_allowlist(descriptors: List[ParameterDescriptor]) -> frozenset[str]:
    """
    Build a frozenset of allowed parameter keys from descriptors.
    
    This allowlist is used to validate parameter override keys in job requests.
    
    Args:
        descriptors: List of parameter descriptors
        
    Returns:
        frozenset[str]: Set of allowed parameter keys
    """
    return frozenset(d.key for d in descriptors)


# Initialize cache and allowlist at module load time
try:
    _PARAMETERS_CACHE = _load_parameters()
    _PARAM_ALLOWLIST = _build_param_allowlist(_PARAMETERS_CACHE)
    print(f"Loaded {len(_PARAMETERS_CACHE)} parameter descriptors, allowlist contains {len(_PARAM_ALLOWLIST)} keys")
except Exception as e:
    print(f"ERROR: Failed to initialize parameters module: {e}")
    # Re-raise to fail fast if parameters cannot be loaded
    raise


def get_param_allowlist() -> frozenset[str]:
    """
    Get the parameter key allowlist for validation.
    
    This function is used by the job submission logic to validate that
    all parameter override keys are in the allowlist.
    
    Returns:
        frozenset[str]: Set of allowed parameter keys
    """
    return _PARAM_ALLOWLIST


@router.get("/parameters", response_model=List[ParameterDescriptor])
async def get_parameters() -> List[ParameterDescriptor]:
    """
    Get the full list of configurable parameters.
    
    Returns the complete parameter descriptor list loaded from the
    parameters.json snapshot. This includes key, label, tooltip, type,
    default value, min/max constraints, enum values, and UI section.
    
    The response is cached at module load time for performance.
    
    Returns:
        List[ParameterDescriptor]: List of all parameter descriptors
        
    Requirements: 3.1
    Validates: Requirements 3.1
    """
    if not _PARAMETERS_CACHE:
        raise HTTPException(
            status_code=500,
            detail="Parameter descriptors not loaded. Check server logs for initialization errors."
        )
    
    return _PARAMETERS_CACHE
