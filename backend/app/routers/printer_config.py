"""
User configuration CRUD for printer, filament, and process configs.

Directory layout (rooted at USER_WORKSPACE or WORKSPACE_ROOT/user_configs):
  autosave/           ← ALL autosaves, flat, shared across types
                        e.g. printer_config.json, process_config.json,
                             filament_1.json, filament_2.json, ...
  printer/            ← explicit user saves (printer)
  filament/           ← explicit user saves (filament)
  process/            ← explicit user saves (process)

Routes
------
  /api/printer-configs
  /api/filament-configs
  /api/process-configs
  /api/autosave/{name}   ← flat autosave CRUD, shared by all config types
"""

import json
import re
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import verify_token
from app.config import settings

router = APIRouter(dependencies=[Depends(verify_token)])

ConfigCategory = Literal["printer", "filament", "process"]

_CATEGORY_DIR: dict[str, Any] = {
    "printer":  lambda: settings.printer_configs_dir,
    "filament": lambda: settings.filament_configs_dir,
    "process":  lambda: settings.process_configs_dir,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_filename(name: str) -> str:
    name = name.strip()
    name = re.sub(r'[/\\:*?"<>|]', "_", name)
    name = re.sub(r'\s+', " ", name)
    if not name:
        raise ValueError("Config name must not be empty")
    return name


def _category_path(category: ConfigCategory, name: str) -> Path:
    return _CATEGORY_DIR[category]() / f"{_safe_filename(name)}.json"


def _autosave_path(name: str) -> Path:
    return settings.autosave_dir / f"{_safe_filename(name)}.json"


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ConfigSaveRequest(BaseModel):
    name: str
    config: dict[str, Any]
    autosave: bool = False  # kept for backward-compat but ignored for the flat endpoints


class AutosaveSaveRequest(BaseModel):
    config: dict[str, Any]


ExternalCategory = Literal["machine", "process", "filament"]

# Maps this module's internal category names (used for CRUD routes and
# directory names — "printer") to the ProfileEntry-compatible category
# literal the frontend/other backend consumers use everywhere else
# ("machine") — see ConfigEntry's doc comment for why this exists.
_EXTERNAL_CATEGORY: dict[str, ExternalCategory] = {
    "printer": "machine",
    "filament": "filament",
    "process": "process",
}


class ConfigEntry(BaseModel):
    """
    A user-saved config entry (printer/filament/process), shaped
    compatibly with profiles.py's ProfileEntry so the frontend can treat
    a saved config exactly like a system profile everywhere it matters
    (selection, job submission, printer/filament/process dialogs) without
    a separate string-prefix convention (the old, now-removed "user:name"
    scheme).

    `path` is the ABSOLUTE filesystem path to the saved config's JSON
    file under USER_WORKSPACE/{printer,filament,process}/ — this is what
    gets sent as e.g. JobRequestModel.printer_profile_path; see
    cli_builder.py's _resolve_profile_path_for_cli for how the backend
    tells this apart from a system profile path (by checking which root
    it falls under) and resolves it (via its own `inherits` name, looked
    up across every manufacturer's vendor index).

    `inherits` is the saved config's own `inherits` field (the name of
    the SYSTEM profile it's based on), surfaced here so callers (e.g. the
    process-config dropdown filtering by printer compatibility) can
    determine compatibility WITHOUT fetching every saved config's full
    JSON individually — a saved config has no `compatible_printers` of
    its own; that only exists on the system profile it inherits from.
    None if the config has no `inherits` field or it couldn't be read.
    """
    name: str
    path: str
    category: ExternalCategory
    is_user: bool = True
    autosave: bool = False
    inherits: str | None = None

# Backward-compat alias
PrinterConfigEntry = ConfigEntry


# ---------------------------------------------------------------------------
# Generic CRUD helpers (for category-specific explicit saves)
# ---------------------------------------------------------------------------

def _read_inherits(path: Path) -> str | None:
    """Best-effort read of a saved config's own `inherits` field, without
    raising — a config missing this field, or one that fails to parse,
    simply has no known compatibility parent (treated as `None`, not an
    error), since listing configs should never fail over one bad file."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None
    if not isinstance(data, dict):
        return None
    inherits = data.get("inherits")
    return inherits if isinstance(inherits, str) else None


def _list_configs(category: ConfigCategory) -> list[ConfigEntry]:
    d = _CATEGORY_DIR[category]()
    if not d.exists():
        return []
    return [
        ConfigEntry(
            name=p.stem,
            path=str(p.resolve()),
            category=_EXTERNAL_CATEGORY[category],
            autosave=False,
            inherits=_read_inherits(p),
        )
        for p in sorted(d.glob("*.json"))
    ]


def _get_config(category: ConfigCategory, name: str) -> dict:
    path = _category_path(category, name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Config '{name}' not found")
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Invalid JSON: {e}")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Error reading file: {e}")


def _save_config(category: ConfigCategory, body: ConfigSaveRequest) -> ConfigEntry:
    try:
        safe = _safe_filename(body.name)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    path = _category_path(category, safe)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(body.config, f, indent=2, ensure_ascii=False)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Error writing file: {e}")
    return ConfigEntry(
        name=safe,
        path=str(path.resolve()),
        category=_EXTERNAL_CATEGORY[category],
        autosave=False,
    )


def _delete_config(category: ConfigCategory, name: str) -> dict:
    path = _category_path(category, name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Config '{name}' not found")
    try:
        path.unlink()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Error deleting file: {e}")
    return {"message": "deleted"}


# ---------------------------------------------------------------------------
# /api/autosave/{name}  — flat, shared autosave directory
# ---------------------------------------------------------------------------

@router.get("/autosave/{name}", response_model=dict)
async def get_autosave(name: str) -> dict:
    """Load an autosaved config by name (e.g. printer_config, filament_1)."""
    path = _autosave_path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Autosave '{name}' not found")
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Invalid JSON: {e}")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Error reading file: {e}")


@router.post("/autosave/{name}", response_model=dict)
async def save_autosave(name: str, body: AutosaveSaveRequest) -> dict:
    """Write an autosave. Creates USER_WORKSPACE/autosave/<name>.json."""
    path = _autosave_path(name)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(body.config, f, indent=2, ensure_ascii=False)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Error writing autosave: {e}")
    return {"name": _safe_filename(name)}


@router.delete("/autosave/{name}")
async def delete_autosave(name: str) -> dict:
    """Delete an autosave. Returns 200 even if it doesn't exist (idempotent)."""
    path = _autosave_path(name)
    try:
        if path.exists():
            path.unlink()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Error deleting autosave: {e}")
    return {"message": "deleted"}


# ---------------------------------------------------------------------------
# /api/printer-configs
# ---------------------------------------------------------------------------

@router.get("/printer-configs", response_model=list[ConfigEntry])
async def list_printer_configs() -> list[ConfigEntry]:
    return _list_configs("printer")

@router.get("/printer-configs/{name}", response_model=dict)
async def get_printer_config(name: str, autosave: bool = False) -> dict:
    # autosave param kept for backward-compat; forward to /api/autosave if needed
    if autosave:
        return await get_autosave(name)
    return _get_config("printer", name)

@router.post("/printer-configs", response_model=ConfigEntry)
async def save_printer_config(body: ConfigSaveRequest) -> ConfigEntry:
    if body.autosave:
        await save_autosave(body.name, AutosaveSaveRequest(config=body.config))
        safe = _safe_filename(body.name)
        return ConfigEntry(
            name=safe,
            path=str(_autosave_path(safe).resolve()),
            category=_EXTERNAL_CATEGORY["printer"],
            autosave=True,
        )
    return _save_config("printer", body)

@router.delete("/printer-configs/{name}")
async def delete_printer_config(name: str, autosave: bool = False) -> dict:
    if autosave:
        return await delete_autosave(name)
    return _delete_config("printer", name)


# ---------------------------------------------------------------------------
# /api/filament-configs
# ---------------------------------------------------------------------------

@router.get("/filament-configs", response_model=list[ConfigEntry])
async def list_filament_configs() -> list[ConfigEntry]:
    return _list_configs("filament")

@router.get("/filament-configs/{name}", response_model=dict)
async def get_filament_config(name: str, autosave: bool = False) -> dict:
    if autosave:
        return await get_autosave(name)
    return _get_config("filament", name)

@router.post("/filament-configs", response_model=ConfigEntry)
async def save_filament_config(body: ConfigSaveRequest) -> ConfigEntry:
    if body.autosave:
        await save_autosave(body.name, AutosaveSaveRequest(config=body.config))
        safe = _safe_filename(body.name)
        return ConfigEntry(
            name=safe,
            path=str(_autosave_path(safe).resolve()),
            category=_EXTERNAL_CATEGORY["filament"],
            autosave=True,
        )
    return _save_config("filament", body)

@router.delete("/filament-configs/{name}")
async def delete_filament_config(name: str, autosave: bool = False) -> dict:
    if autosave:
        return await delete_autosave(name)
    return _delete_config("filament", name)


# ---------------------------------------------------------------------------
# /api/process-configs
# ---------------------------------------------------------------------------

@router.get("/process-configs", response_model=list[ConfigEntry])
async def list_process_configs() -> list[ConfigEntry]:
    return _list_configs("process")

@router.get("/process-configs/{name}", response_model=dict)
async def get_process_config_endpoint(name: str, autosave: bool = False) -> dict:
    if autosave:
        return await get_autosave(name)
    return _get_config("process", name)

@router.post("/process-configs", response_model=ConfigEntry)
async def save_process_config(body: ConfigSaveRequest) -> ConfigEntry:
    if body.autosave:
        await save_autosave(body.name, AutosaveSaveRequest(config=body.config))
        safe = _safe_filename(body.name)
        return ConfigEntry(
            name=safe,
            path=str(_autosave_path(safe).resolve()),
            category=_EXTERNAL_CATEGORY["process"],
            autosave=True,
        )
    return _save_config("process", body)

@router.delete("/process-configs/{name}")
async def delete_process_config(name: str, autosave: bool = False) -> dict:
    if autosave:
        return await delete_autosave(name)
    return _delete_config("process", name)
