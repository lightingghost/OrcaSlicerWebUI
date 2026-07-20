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
    """
    selected_manufacturer: Optional[str] = None
    selected_printer_profile_path: Optional[str] = None
    selected_bed_type: Optional[str] = None
    selected_process_profile_path: Optional[str] = None
    selected_filament_profile_paths: list[str] = []


def _get_user_config_path(session_id: str = "default") -> Path:
    """
    Get the path to the user config file for a given session.
    
    Args:
        session_id: Session identifier for organizing user configs
        
    Returns:
        Path to user_config.yaml file
    """
    config_dir = settings.workspace_root / "user_configs" / session_id
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
        
    The configuration is saved as YAML at workspace/user_configs/{session_id}/user_config.yaml
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
