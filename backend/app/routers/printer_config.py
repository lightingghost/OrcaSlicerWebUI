"""
Printer configuration management API routes.

Handles saving, loading, and listing user-customized printer configurations.
Configs are saved in two locations:
  - Autosave: workspace/user_configs/autosave/<name>.json  (written on every edit)
  - Saved:    workspace/user_configs/<name>.json           (written on explicit save)

The "user_configs/autosave" path is intentionally nested *inside* user_configs so
that the saved-config listing can skip it by name.
"""

import json
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import verify_token
from app.config import settings

router = APIRouter(dependencies=[Depends(verify_token)])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _user_configs_dir() -> Path:
    """Root of the user printer-config directory tree."""
    return settings.workspace_root / "user_configs"


def _autosave_dir() -> Path:
    return _user_configs_dir() / "autosave"


def _safe_filename(name: str) -> str:
    """Convert an arbitrary string to a safe filename (no slashes / special chars)."""
    name = name.strip()
    # Replace path separators and other problematic characters
    name = re.sub(r'[/\\:*?"<>|]', "_", name)
    # Collapse whitespace
    name = re.sub(r'\s+', " ", name)
    if not name:
        raise ValueError("Config name must not be empty")
    return name


def _config_path(name: str, autosave: bool = False) -> Path:
    """Return the JSON file path for a given config name."""
    safe = _safe_filename(name)
    base = _autosave_dir() if autosave else _user_configs_dir()
    return base / f"{safe}.json"


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class PrinterConfigSaveRequest(BaseModel):
    """
    Request body for saving a printer configuration.

    Attributes:
        name:    Human-readable display name for the config (used as filename).
        config:  Arbitrary key/value pairs from the printer profile editor.
        autosave: When True the config is written to the autosave directory
                  instead of the main user_configs directory.
    """
    name: str
    config: dict[str, Any]
    autosave: bool = False


class PrinterConfigEntry(BaseModel):
    """
    Summary entry returned when listing saved printer configs.

    Attributes:
        name:  Display name of the config.
        path:  Relative path token (same as the name, used as the key for
               GET/DELETE operations).
        autosave: Whether this entry lives in the autosave directory.
    """
    name: str
    path: str
    autosave: bool = False


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/printer-configs", response_model=list[PrinterConfigEntry])
async def list_printer_configs() -> list[PrinterConfigEntry]:
    """
    List all saved user printer configurations.

    Returns configs from workspace/user_configs/*.json  (explicitly saved)
    and workspace/user_configs/autosave/*.json (autosaved).

    Returns:
        List[PrinterConfigEntry]: Sorted list of saved printer configs.
    """
    results: list[PrinterConfigEntry] = []

    user_dir = _user_configs_dir()
    autosave_dir = _autosave_dir()

    # Explicitly saved configs (top-level *.json, skip the autosave sub-dir)
    if user_dir.exists():
        for p in sorted(user_dir.glob("*.json")):
            results.append(PrinterConfigEntry(name=p.stem, path=p.stem, autosave=False))

    # Autosaved configs
    if autosave_dir.exists():
        for p in sorted(autosave_dir.glob("*.json")):
            results.append(PrinterConfigEntry(name=p.stem, path=p.stem, autosave=True))

    return results


@router.get("/printer-configs/{name}", response_model=dict)
async def get_printer_config(name: str, autosave: bool = False) -> dict:
    """
    Load a single saved printer configuration by name.

    Args:
        name:     Config name (the stem of the .json file).
        autosave: When True, look in the autosave directory instead.

    Returns:
        dict: The raw config JSON.

    Raises:
        HTTPException 404: If the config does not exist.
        HTTPException 500: If the file cannot be read or parsed.
    """
    path = _config_path(name, autosave=autosave)

    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Printer config '{name}' not found")

    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Invalid JSON in config file: {e}")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Error reading config file: {e}")


@router.post("/printer-configs", response_model=PrinterConfigEntry)
async def save_printer_config(body: PrinterConfigSaveRequest) -> PrinterConfigEntry:
    """
    Save (or overwrite) a printer configuration.

    When ``autosave`` is True the config is written to
    ``workspace/user_configs/autosave/<name>.json``; otherwise it is written to
    ``workspace/user_configs/<name>.json``.

    Args:
        body: SaveRequest with name, config dict, and autosave flag.

    Returns:
        PrinterConfigEntry: Entry describing the newly saved config.

    Raises:
        HTTPException 422: If the name is invalid.
        HTTPException 500: If the file cannot be written.
    """
    try:
        safe = _safe_filename(body.name)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    path = _config_path(safe, autosave=body.autosave)

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(body.config, f, indent=2, ensure_ascii=False)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Error writing config file: {e}")

    return PrinterConfigEntry(name=safe, path=safe, autosave=body.autosave)


@router.delete("/printer-configs/{name}")
async def delete_printer_config(name: str, autosave: bool = False) -> dict:
    """
    Delete a saved printer configuration.

    Args:
        name:     Config name (the stem of the .json file).
        autosave: When True, delete from the autosave directory.

    Returns:
        dict: ``{"message": "deleted"}``

    Raises:
        HTTPException 404: If the config does not exist.
        HTTPException 500: If the file cannot be deleted.
    """
    path = _config_path(name, autosave=autosave)

    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Printer config '{name}' not found")

    try:
        path.unlink()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Error deleting config file: {e}")

    return {"message": "deleted"}
