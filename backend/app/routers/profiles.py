"""
Profile management API routes.

This module implements endpoints for browsing and selecting printer, process,
and filament profiles bundled with OrcaSlicer.

Requirements: 2.1, 2.2, 2.5
"""

import json
import os
import uuid
from pathlib import Path
from typing import List, Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from app.auth import verify_token
from app.config import settings


router = APIRouter(dependencies=[Depends(verify_token)])


class ProfileEntry(BaseModel):
    """
    Represents a single profile file entry.
    
    Attributes:
        name: Display name of the profile (filename without .json extension)
        path: Relative path to the profile file from resources/profiles/
        category: Type of profile (machine, process, or filament)
    """
    name: str
    path: str
    category: Literal["machine", "process", "filament"]


class CustomProfileResponse(BaseModel):
    """
    Response model for custom profile upload.
    
    Attributes:
        profile_id: Unique identifier for the uploaded custom profile
    """
    profile_id: str


def _get_profiles_root() -> Path:
    """
    Helper function to locate the profiles directory.
    
    Returns:
        Path: Path to the resources/profiles directory
        
    Raises:
        HTTPException: If profiles directory cannot be found
    """
    cli_path = Path(settings.orca_cli_path)
    
    # Navigate from CLI binary location to resources/profiles
    # Try different possible structures:
    # 1. OrcaSlicer/build/linux/OrcaSlicer_ubu64 -> go up 3 levels
    # 2. OrcaSlicer/build/linux/release/OrcaSlicer_ubu64 -> go up 4 levels
    # 3. Direct path if CLI is in root (for testing)
    
    orca_root = None
    for levels_up in [3, 4, 2]:
        potential_root = cli_path
        for _ in range(levels_up):
            potential_root = potential_root.parent
        profiles_candidate = potential_root / "resources" / "profiles"
        if profiles_candidate.exists() and profiles_candidate.is_dir():
            orca_root = potential_root
            break
    
    # If that didn't work, try relative to current working directory (for testing)
    if orca_root is None:
        # Try relative to backend directory
        backend_dir = Path(__file__).parent.parent.parent
        orca_candidate = backend_dir.parent / "OrcaSlicer" / "resources" / "profiles"
        if orca_candidate.exists() and orca_candidate.is_dir():
            return orca_candidate
        else:
            raise HTTPException(
                status_code=500,
                detail=f"Profiles directory not found. Checked relative to CLI path {cli_path} and {orca_candidate}"
            )
    
    profiles_root = orca_root / "resources" / "profiles"
    
    if not profiles_root.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Profiles directory not found at {profiles_root}"
        )
    
    if not profiles_root.is_dir():
        raise HTTPException(
            status_code=500,
            detail=f"Profiles path is not a directory: {profiles_root}"
        )
    
    return profiles_root


@router.get("/profiles", response_model=List[ProfileEntry])
async def get_all_profiles(manufacturer: str | None = None) -> List[ProfileEntry]:
    """
    Get list of all profile JSON files across all manufacturers, or filtered by manufacturer.
    
    This endpoint aggregates profiles from all manufacturer directories, optionally
    filtering by a specific manufacturer if provided as a query parameter.
    
    Args:
        manufacturer: Optional manufacturer name to filter profiles
        
    Returns:
        List[ProfileEntry]: List of profile entries found across manufacturers
        
    Requirements: 2.2 (optimization)
    """
    profiles_root = _get_profiles_root()
    all_profiles = []
    
    # Get list of manufacturers to scan
    manufacturers_to_scan = []
    if manufacturer:
        # Single manufacturer filter
        manufacturer_dir = profiles_root / manufacturer
        if not manufacturer_dir.exists() or not manufacturer_dir.is_dir():
            raise HTTPException(
                status_code=404,
                detail=f"Manufacturer '{manufacturer}' not found"
            )
        manufacturers_to_scan = [manufacturer]
    else:
        # All manufacturers
        try:
            for entry in os.listdir(profiles_root):
                entry_path = profiles_root / entry
                if entry_path.is_dir():
                    manufacturers_to_scan.append(entry)
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Error reading profiles directory: {str(e)}"
            )
    
    # Scan each manufacturer
    for mfr in manufacturers_to_scan:
        manufacturer_dir = profiles_root / mfr
        
        # Categories to scan
        categories = ["machine", "process", "filament"]
        
        for category in categories:
            category_dir = manufacturer_dir / category
            
            # Skip if category directory doesn't exist
            if not category_dir.exists() or not category_dir.is_dir():
                continue
            
            try:
                # Walk the category directory recursively to find all JSON files
                for root, dirs, files in os.walk(category_dir):
                    for file in files:
                        # Only include JSON files
                        if file.endswith('.json'):
                            file_path = Path(root) / file
                            
                            # Compute relative path from profiles_root
                            try:
                                rel_path = file_path.relative_to(profiles_root)
                            except ValueError:
                                continue
                            
                            # Extract display name (filename without .json extension)
                            name = file[:-5]
                            
                            all_profiles.append(ProfileEntry(
                                name=name,
                                path=str(rel_path),
                                category=category  # type: ignore
                            ))
            except PermissionError:
                raise HTTPException(
                    status_code=500,
                    detail=f"Permission denied reading category directory: {category_dir}"
                )
            except Exception as e:
                raise HTTPException(
                    status_code=500,
                    detail=f"Error reading category directory {category}: {str(e)}"
                )
    
    # Sort profiles by name for consistent ordering
    all_profiles.sort(key=lambda p: p.name)
    
    return all_profiles


@router.get("/profiles/manufacturers", response_model=List[str])
async def get_manufacturers() -> List[str]:
    """
    Get list of all manufacturer directories under resources/profiles/.
    
    Scans the profiles directory for subdirectories (excluding files like .json files)
    and returns a sorted list of manufacturer names.
    
    Returns:
        List[str]: Sorted list of manufacturer directory names
        
    Requirements: 2.1
    Validates: Requirements 2.1
    """
    profiles_root = _get_profiles_root()
    
    # Scan for subdirectories (manufacturer directories)
    manufacturers = []
    try:
        for entry in os.listdir(profiles_root):
            entry_path = profiles_root / entry
            # Only include directories, exclude files (like .json files)
            if entry_path.is_dir():
                manufacturers.append(entry)
    except PermissionError:
        raise HTTPException(
            status_code=500,
            detail=f"Permission denied reading profiles directory: {profiles_root}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error reading profiles directory: {str(e)}"
        )
    
    # Sort alphabetically for consistent ordering
    manufacturers.sort()
    
    return manufacturers


class FilamentProfileInfo(BaseModel):
    """
    Information about a single filament profile.
    
    Attributes:
        name: Display name of the filament profile
        path: Relative path to the profile file
        material_type: Detected material type (PLA, PETG, etc.)
        compatible_printers: List of printer profile names this filament is compatible with
    """
    name: str
    path: str
    material_type: str
    compatible_printers: List[str]


class FilamentMetadata(BaseModel):
    """
    Metadata about available filaments for filtering.
    
    Attributes:
        manufacturers: List of manufacturers that have filament profiles
        material_types: List of detected material types (PLA, PETG, etc.)
        filaments: List of all filament profiles with compatibility info
    """
    manufacturers: List[str]
    material_types: List[str]
    filaments: List[FilamentProfileInfo]


def _extract_material_type(profile_name: str) -> str:
    """
    Extract material type from filament profile name.
    
    Args:
        profile_name: Name of the filament profile
        
    Returns:
        Material type string (e.g., "PLA", "PETG", "PA-CF")
    """
    upper = profile_name.upper()
    
    # Check for composite materials first (order matters)
    if 'PA-CF' in upper or 'PA CF' in upper:
        return 'PA-CF'
    if 'PLA-CF' in upper or 'PLA CF' in upper:
        return 'PLA-CF'
    if 'PETG-CF' in upper or 'PETG CF' in upper:
        return 'PETG-CF'
    if 'PC-CF' in upper or 'PC CF' in upper:
        return 'PC-CF'
    if 'PA-GF' in upper or 'PA GF' in upper:
        return 'PA-GF'
    
    # Check for basic materials
    if 'PLA' in upper:
        return 'PLA'
    if 'PETG' in upper:
        return 'PETG'
    if 'ABS' in upper:
        return 'ABS'
    if 'ASA' in upper:
        return 'ASA'
    if 'TPU' in upper:
        return 'TPU'
    if 'NYLON' in upper or 'PA' in upper:
        return 'Nylon/PA'
    if 'PC' in upper:
        return 'PC'
    if 'PVA' in upper:
        return 'PVA'
    if 'HIPS' in upper:
        return 'HIPS'
    
    return 'Other'


@router.get("/filament-metadata", response_model=FilamentMetadata)
async def get_filament_metadata() -> FilamentMetadata:
    """
    Get metadata about available filament profiles for building filters.
    
    Scans all manufacturers and their filament profiles to extract:
    - List of manufacturers that have filament profiles
    - List of unique material types detected across all filaments
    - Complete list of filament profiles with compatibility information
    
    Returns:
        FilamentMetadata: Object containing manufacturers, material_types, and filaments lists
        
    This endpoint is optimized for building filter dropdowns and compatibility filtering in the UI.
    The frontend receives all data in one request instead of fetching each filament individually.
    """
    profiles_root = _get_profiles_root()
    
    manufacturers_with_filaments = set()
    material_types = set()
    filaments = []
    
    try:
        # Scan all manufacturer directories
        for manufacturer_entry in os.listdir(profiles_root):
            manufacturer_path = profiles_root / manufacturer_entry
            
            # Skip if not a directory
            if not manufacturer_path.is_dir():
                continue
            
            # Check for filament subdirectory
            filament_dir = manufacturer_path / "filament"
            if not filament_dir.exists() or not filament_dir.is_dir():
                continue
            
            # Walk the filament directory to find JSON files
            has_filaments = False
            for root, dirs, files in os.walk(filament_dir):
                for file in files:
                    if file.endswith('.json'):
                        has_filaments = True
                        file_path = Path(root) / file
                        
                        # Compute relative path from profiles_root
                        try:
                            rel_path = file_path.relative_to(profiles_root)
                        except ValueError:
                            continue
                        
                        # Extract display name (filename without .json)
                        profile_name = file[:-5]
                        
                        # Extract material type
                        material_type = _extract_material_type(profile_name)
                        material_types.add(material_type)
                        
                        # Read JSON to extract compatible_printers
                        compatible_printers = []
                        try:
                            with open(file_path, 'r', encoding='utf-8') as f:
                                profile_data = json.load(f)
                                if 'compatible_printers' in profile_data:
                                    compatible_printers = profile_data['compatible_printers']
                                    if not isinstance(compatible_printers, list):
                                        compatible_printers = []
                        except Exception as e:
                            # Log error but continue processing other files
                            print(f"Warning: Failed to read {file_path}: {e}")
                        
                        # Add filament info
                        filaments.append(FilamentProfileInfo(
                            name=profile_name,
                            path=str(rel_path),
                            material_type=material_type,
                            compatible_printers=compatible_printers
                        ))
            
            # Add manufacturer to set if they have filaments
            if has_filaments:
                manufacturers_with_filaments.add(manufacturer_entry)
                
    except PermissionError:
        raise HTTPException(
            status_code=500,
            detail=f"Permission denied reading profiles directory: {profiles_root}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error reading profiles directory: {str(e)}"
        )
    
    # Convert sets to sorted lists
    manufacturers_list = sorted(manufacturers_with_filaments)
    material_types_list = sorted(material_types)
    
    # Sort filaments by name for consistency
    filaments.sort(key=lambda f: f.name)
    
    return FilamentMetadata(
        manufacturers=manufacturers_list,
        material_types=material_types_list,
        filaments=filaments
    )


@router.get("/profiles/{manufacturer}", response_model=List[ProfileEntry])
async def get_manufacturer_profiles(manufacturer: str) -> List[ProfileEntry]:
    """
    Get list of profile JSON files for a specific manufacturer.
    
    Walks the manufacturer directory tree to find all .json files in the
    machine/, process/, and filament/ subdirectories. Returns profile entries
    with name, path (relative to resources/profiles/), and category.
    
    Args:
        manufacturer: Name of the manufacturer directory
        
    Returns:
        List[ProfileEntry]: List of profile entries found for the manufacturer
        
    Raises:
        HTTPException: 404 if manufacturer directory not found
        
    Requirements: 2.2
    Validates: Requirements 2.2
    """
    profiles_root = _get_profiles_root()
    manufacturer_dir = profiles_root / manufacturer
    
    # Check if manufacturer directory exists
    if not manufacturer_dir.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Manufacturer '{manufacturer}' not found"
        )
    
    if not manufacturer_dir.is_dir():
        raise HTTPException(
            status_code=404,
            detail=f"Manufacturer path is not a directory: {manufacturer}"
        )
    
    profiles = []
    
    # Categories to scan
    categories = ["machine", "process", "filament"]
    
    for category in categories:
        category_dir = manufacturer_dir / category
        
        # Skip if category directory doesn't exist
        if not category_dir.exists() or not category_dir.is_dir():
            continue
        
        try:
            # Walk the category directory recursively to find all JSON files
            for root, dirs, files in os.walk(category_dir):
                for file in files:
                    # Only include JSON files
                    if file.endswith('.json'):
                        file_path = Path(root) / file
                        
                        # Compute relative path from profiles_root
                        try:
                            rel_path = file_path.relative_to(profiles_root)
                        except ValueError:
                            # Skip if path cannot be made relative (shouldn't happen)
                            continue
                        
                        # Extract display name (filename without .json extension)
                        name = file[:-5]  # Remove .json extension
                        
                        profiles.append(ProfileEntry(
                            name=name,
                            path=str(rel_path),
                            category=category  # type: ignore - Literal type is checked
                        ))
        except PermissionError:
            raise HTTPException(
                status_code=500,
                detail=f"Permission denied reading category directory: {category_dir}"
            )
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Error reading category directory {category}: {str(e)}"
            )
    
    # Sort profiles by name for consistent ordering
    profiles.sort(key=lambda p: p.name)
    
    return profiles


@router.post("/profiles/custom", response_model=CustomProfileResponse)
async def upload_custom_profile(
    file: UploadFile = File(...),
    session_id: str = "default"  # TODO: Extract from request context/auth in future
) -> CustomProfileResponse:
    """
    Upload a custom profile JSON file.
    
    Accepts a JSON file upload, validates that it parses as valid JSON,
    stores it under workspace/custom_profiles/{session_id}/{profile_id}.json,
    and returns the profile_id.
    
    Args:
        file: The uploaded JSON file
        session_id: Session identifier for organizing custom profiles (defaults to "default")
        
    Returns:
        CustomProfileResponse: Contains the unique profile_id for the uploaded profile
        
    Raises:
        HTTPException: 422 if the uploaded file is not valid JSON
        HTTPException: 500 if there's an error storing the file
        
    Requirements: 2.5
    Validates: Requirements 2.5
    """
    # Validate file extension is .json
    if not file.filename or not file.filename.endswith('.json'):
        raise HTTPException(
            status_code=422,
            detail="File must be a JSON file with .json extension"
        )
    
    # Read file content
    try:
        content = await file.read()
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error reading uploaded file: {str(e)}"
        )
    
    # Validate JSON parsing
    try:
        # Attempt to parse as JSON to validate
        json.loads(content)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid JSON format: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail=f"Error parsing JSON: {str(e)}"
        )
    
    # Generate unique profile_id (UUID v4)
    profile_id = str(uuid.uuid4())
    
    # Construct storage path: workspace/custom_profiles/{session_id}/{profile_id}.json
    session_dir = settings.custom_profiles_dir / session_id
    profile_path = session_dir / f"{profile_id}.json"
    
    # Create session directory if it doesn't exist
    try:
        session_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error creating custom profiles directory: {str(e)}"
        )
    
    # Write the profile file
    try:
        with open(profile_path, 'wb') as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error writing profile file: {str(e)}"
        )
    
    return CustomProfileResponse(profile_id=profile_id)


def _load_vendor_index(profiles_root: Path, manufacturer: str) -> dict | None:
    """
    Load the vendor index file (e.g. resources/profiles/Flashforge.json) for a
    manufacturer, which maps profile `name` values to their `sub_path`
    (relative to the manufacturer directory) for the machine, process, and
    filament categories. Returns None if the vendor index cannot be found.
    """
    vendor_file = profiles_root / f"{manufacturer}.json"
    if not vendor_file.exists() or not vendor_file.is_file():
        return None

    try:
        with open(vendor_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


# Vendor index keys that list profiles for each category, keyed by the same
# `category` literal used elsewhere in this module.
_VENDOR_LIST_KEY = {
    "machine": "machine_list",
    "process": "process_list",
    "filament": "filament_list",
}


def _find_sub_path_by_name(
    vendor_index: dict, category: str, name: str
) -> str | None:
    """
    Look up a profile's `sub_path` (relative to the manufacturer directory)
    by its `name` within a vendor index's category list.
    """
    list_key = _VENDOR_LIST_KEY.get(category)
    if not list_key:
        return None

    for entry in vendor_index.get(list_key, []):
        if entry.get("name") == name:
            return entry.get("sub_path")

    return None


def resolve_profile_config(
    profiles_root: Path, manufacturer: str, category: str, filename: str
) -> dict:
    """
    Resolve a profile's full effective configuration by walking its
    `inherits` chain (profile -> parent -> grandparent -> ... -> root) and
    merging key/value pairs, with values from more specific (child) profiles
    taking precedence over values from more general (ancestor) profiles.

    OrcaSlicer profile JSON files only store the keys that differ from their
    parent. A profile's `inherits` field names its parent by the parent's
    `name` field, which is looked up in the manufacturer's vendor index file
    (e.g. resources/profiles/Flashforge.json) to find the parent file's
    `sub_path`. This mirrors how the native OrcaSlicer desktop app resolves
    profile settings.

    Args:
        profiles_root: Path to resources/profiles
        manufacturer: Manufacturer directory name (e.g. "Flashforge")
        category: Profile category ("machine", "process", or "filament")
        filename: Filename of the starting profile (with .json extension),
            may include subdirectories

    Returns:
        dict: Merged configuration with all inherited keys resolved,
            including bookkeeping fields (name, inherits, etc.) from the
            most specific profile in the chain.

    Raises:
        HTTPException: 404 if the starting profile file cannot be found,
            500 if a profile's JSON cannot be parsed
    """
    from app.cli_builder import resolve_and_guard

    relative_path = Path(manufacturer) / category / filename
    try:
        full_path = resolve_and_guard(relative_path, profiles_root)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"Invalid path: {str(e)}")

    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"Profile not found: {manufacturer}/{category}/{filename}",
        )

    # Walk the inherits chain, collecting configs from most specific (first)
    # to most general (last), so we can merge them in reverse (base first).
    chain: list[dict] = []
    visited_names: set[str] = set()
    vendor_index = _load_vendor_index(profiles_root, manufacturer)

    current_path: Path | None = full_path
    while current_path is not None:
        try:
            with open(current_path, "r", encoding="utf-8") as f:
                content = json.load(f)
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=500,
                detail=f"Invalid JSON in profile file {current_path}: {str(e)}",
            )
        except OSError as e:
            raise HTTPException(
                status_code=500,
                detail=f"Error reading profile file {current_path}: {str(e)}",
            )

        chain.append(content)

        parent_name = content.get("inherits")
        current_path = None

        if parent_name:
            # Guard against inheritance cycles.
            if parent_name in visited_names:
                break
            visited_names.add(parent_name)

            if vendor_index is not None:
                parent_sub_path = _find_sub_path_by_name(
                    vendor_index, category, parent_name
                )
                if parent_sub_path:
                    candidate = profiles_root / manufacturer / parent_sub_path
                    try:
                        current_path = resolve_and_guard(
                            Path(manufacturer) / parent_sub_path, profiles_root
                        )
                    except ValueError:
                        current_path = None
                    else:
                        if not current_path.exists() or not current_path.is_file():
                            current_path = None

    # Merge base-to-specific so child values override ancestor values.
    merged: dict = {}
    for profile_content in reversed(chain):
        merged.update(profile_content)

    return merged


@router.get("/profiles/{manufacturer}/{category}/{filename:path}/resolved")
async def get_resolved_profile_content(
    manufacturer: str,
    category: Literal["machine", "process", "filament"],
    filename: str,
) -> dict:
    """
    Fetch a profile's fully resolved effective configuration, with its
    `inherits` chain merged in (ancestor values first, overridden by more
    specific descendant values) - matching what the native OrcaSlicer
    desktop app actually applies when a profile is selected.

    Unlike GET /profiles/{manufacturer}/{category}/{filename}, which returns
    only the raw JSON of a single file (often just a handful of overridden
    keys), this endpoint returns every effective key/value for the profile.

    Args:
        manufacturer: Name of the manufacturer directory
        category: Profile category (machine, process, or filament)
        filename: Name of the JSON file (with .json extension), may include
            subdirectories

    Returns:
        dict: The merged, effective configuration for the profile

    Raises:
        HTTPException: 404 if file not found, 422 if path traversal
            detected, 500 if a file in the chain cannot be read or parsed
    """
    profiles_root = _get_profiles_root()
    return resolve_profile_config(profiles_root, manufacturer, category, filename)


@router.get("/profiles/{manufacturer}/{category}/{filename:path}")
async def get_profile_content(
    manufacturer: str,
    category: Literal["machine", "process", "filament"],
    filename: str
) -> dict:
    """
    Fetch raw profile JSON content for a specific profile file.
    
    Reads and returns the JSON content of a profile file. Applies path guard
    to prevent directory traversal attacks.
    
    The filename parameter can include subdirectories (e.g., "AliZ/AliZ PA-CF @P1-X1.json")
    to support nested profile structures.
    
    Args:
        manufacturer: Name of the manufacturer directory
        category: Profile category (machine, process, or filament)
        filename: Name of the JSON file (with .json extension), may include subdirectories
        
    Returns:
        dict: The parsed JSON content of the profile file
        
    Raises:
        HTTPException: 404 if file not found, 422 if path traversal detected,
                      500 if file cannot be read or parsed
        
    Requirements: 2.2, 11.3
    Validates: Requirements 2.3
    """
    from app.cli_builder import resolve_and_guard
    
    profiles_root = _get_profiles_root()
    
    # Construct relative path: manufacturer/category/filename (filename may include subdirectories)
    relative_path = Path(manufacturer) / category / filename
    
    # Apply path guard to prevent traversal
    try:
        full_path = resolve_and_guard(relative_path, profiles_root)
    except ValueError as e:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid path: {str(e)}"
        )
    
    # Check if file exists
    if not full_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Profile not found: {manufacturer}/{category}/{filename}"
        )
    
    # Check if it's actually a file
    if not full_path.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"Path is not a file: {manufacturer}/{category}/{filename}"
        )
    
    # Read and parse JSON
    try:
        with open(full_path, 'r', encoding='utf-8') as f:
            content = json.load(f)
        return content
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Invalid JSON in profile file: {str(e)}"
        )
    except PermissionError:
        raise HTTPException(
            status_code=500,
            detail=f"Permission denied reading profile file"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error reading profile file: {str(e)}"
        )
