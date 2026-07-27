"""
User configuration management API routes.

This module implements endpoints for saving and loading user preferences
such as selected printer, bed type, filaments, and process profiles.
"""

import os
import yaml
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import verify_token
from app.config import settings


router = APIRouter(dependencies=[Depends(verify_token)])


class UserConfig(BaseModel):
    """
    User configuration model for persisting selections.

    Attributes:
        selected_manufacturer: Currently selected manufacturer name
        selected_printer_profile_path: Path to selected printer profile
        selected_bed_type: Selected bed type (physical plate)
        selected_process_profile_path: Path to selected process profile
        selected_filament_profile_paths: List of paths to selected filament profiles
        printer_config_autosave: Pending (unsaved) edits made in the Printer
            settings dialog for the currently selected printer profile, keyed
            the same way as USER_WORKSPACE/autosave/printer_config.json (a
            diff dict with a `_profile_path` marker identifying which
            profile the edits belong to). None if there are no pending edits.
        process_config_autosave: Same, for the Process parameter panel
            (USER_WORKSPACE/autosave/process_config.json).
        filament_config_autosaves: Same, one entry per selected filament
            profile, index-aligned with selected_filament_profile_paths
            (matching the existing autosave/filament_N.json numbering).
            Each non-null entry carries its own `_profile_path` marker so
            stale autosaves (e.g. after reordering) can be detected and
            ignored rather than misapplied to the wrong filament.
            None entries mean no pending edits for that filament.
        object_config_autosaves: Per-object process (print) config
            overrides, keyed by the plate object's file_id, mirroring
            USER_WORKSPACE/autosave/process_config_object_{file_id}.json.
            Each entry is that object's own override dict (keys the user
            has explicitly changed for that specific object — see the
            Global/Objects toggle in the Process panel). A missing or
            null entry means that object has no overrides of its own and
            fully inherits from the global process settings.
    """
    selected_manufacturer: Optional[str] = None
    selected_printer_profile_path: Optional[str] = None
    selected_bed_type: Optional[str] = None
    selected_process_profile_path: Optional[str] = None
    selected_filament_profile_paths: list[str] = []
    printer_config_autosave: Optional[dict] = None
    process_config_autosave: Optional[dict] = None
    filament_config_autosaves: list[Optional[dict]] = []
    object_config_autosaves: dict[str, Optional[dict]] = {}


def _get_user_config_path(session_id: str = "default") -> Path:
    """
    Get the path to the user config file for a given session.
    
    Args:
        session_id: Session identifier for organizing user configs
        
    Returns:
        Path to user_config.yaml file
    """
    config_dir = settings.user_workspace_root / session_id
    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir / "user_config.yaml"


@router.get("/user-config", response_model=UserConfig)
async def get_user_config(session_id: str = "default") -> UserConfig:
    """
    Load user configuration from YAML file.
    
    Args:
        session_id: Session identifier (defaults to "default")
        
    Returns:
        UserConfig: The loaded user configuration
        
    If no config file exists, returns an empty configuration.
    """
    config_path = _get_user_config_path(session_id)
    
    if not config_path.exists():
        # Return empty config if file doesn't exist
        return UserConfig()
    
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
            
        if data is None:
            return UserConfig()
            
        return UserConfig(**data)
    except yaml.YAMLError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to parse user config YAML: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load user config: {str(e)}"
        )


@router.post("/user-config", response_model=UserConfig)
async def save_user_config(
    config: UserConfig,
    session_id: str = "default"
) -> UserConfig:
    """
    Save user configuration to YAML file.
    
    Args:
        config: User configuration to save
        session_id: Session identifier (defaults to "default")
        
    Returns:
        UserConfig: The saved configuration (echoed back)
        
    The configuration is saved as YAML at USER_WORKSPACE/{session_id}/user_config.yaml
    """
    config_path = _get_user_config_path(session_id)
    
    try:
        # Convert Pydantic model to dict for YAML serialization
        config_dict = config.model_dump()
        
        # Write to YAML file
        with open(config_path, 'w', encoding='utf-8') as f:
            yaml.dump(config_dict, f, default_flow_style=False, allow_unicode=True)
            
        return config
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save user config: {str(e)}"
        )


@router.delete("/user-config")
async def delete_user_config(session_id: str = "default") -> dict:
    """
    Delete user configuration file.
    
    Args:
        session_id: Session identifier (defaults to "default")
        
    Returns:
        dict: Success message
    """
    config_path = _get_user_config_path(session_id)
    
    if not config_path.exists():
        raise HTTPException(
            status_code=404,
            detail="User config file not found"
        )
    
    try:
        config_path.unlink()
        return {"message": "User config deleted successfully"}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete user config: {str(e)}"
        )
