"""
Device connection API routes.

Lets the frontend's Device tab persist and test a connection to a local
printer host (OctoPrint/Klipper via a Moonraker agent, matching native
OrcaSlicer's "Physical Printer" > "Print Host upload" dialog — see
libslic3r/PrintConfig.cpp's host_type/printer_agent/print_host/
print_host_webui/printhost_apikey/printhost_cafile option definitions and
slic3r/GUI/PhysicalPrinterDialog.cpp's field layout).

Unlike printer/process/filament slicing profiles (printer_config.py),
this is not a CLI-facing setting at all — the OrcaSlicer CLI never
uploads to a print host itself (that's a desktop-GUI-only feature, see
slic3r/GUI/Plater.cpp's send-to-print flow). This webapp implements the
"Device" tab as its own thin client: it persists connection settings and
proxies a Moonraker connectivity test server-side (browsers can't easily
reach arbitrary LAN hosts over plain HTTP from a mixed-content HTTPS
page, and server-side avoids CORS entirely), then lets the frontend embed
the printer's own web UI (Mainsail/Fluidd/etc, at `device_ui`) in an
iframe once connected — there is no gcode-upload/print-start
functionality here, only "is this printer reachable" + "show me its UI".
"""

from pathlib import Path
from typing import Literal, Optional

import aiosqlite
import httpx
import yaml
from fastapi import APIRouter, Depends, HTTPException

from app.auth import verify_token
from app.cli_builder import resolve_and_guard
from app.config import settings
from app.database import get_db
from pydantic import BaseModel, Field

router = APIRouter(dependencies=[Depends(verify_token)])


# Host types supported by this Device tab. Native OrcaSlicer's `host_type`
# enum has many more values (PrusaLink, Duet, etc — see
# PrintConfig.cpp:134-151), but this webapp only implements the
# "Octo/Klipper" combined option (native's actual enum label for
# `htOctoPrint`) paired with the Moonraker printer agent, matching this
# feature's explicit scope.
HostType = Literal["octo_klipper"]
PrinterAgent = Literal["moonraker"]


class DeviceConnection(BaseModel):
    """
    Printer connection settings for the Device tab, mirroring native's
    physical-printer "Print Host upload" fields.

    Attributes:
        host_type: Print host protocol family. Only "octo_klipper" (native's
            "Octo/Klipper" host_type option) is currently supported.
        printer_agent: Network agent implementation. Only "moonraker" is
            currently supported (native's registered IPrinterAgent id).
        print_host: Hostname, IP, or URL of the printer host instance
            (native's `print_host` — e.g. "http://192.168.1.50" or
            "192.168.1.50:7125" for a bare Moonraker port).
        device_ui: URL of the printer's own web UI (Mainsail/Fluidd/etc)
            to embed once connected (native's `print_host_webui`). Falls
            back to `print_host` if empty, matching
            `PrintHost::get_print_host_webui()`.
        printhost_apikey: API key / password (native's `printhost_apikey`).
            Sent as the `X-Api-Key` header on Moonraker requests, matching
            `Moonraker::set_auth()` — never used for HTTP Basic/Digest,
            which are not part of the Moonraker spec.
        printhost_cafile: Optional path to a custom CA certificate file
            for HTTPS connections with a self-signed cert (native's
            `printhost_cafile`). Reserved for parity with the native field
            set; this webapp does not yet act on it (see
            `test_device_connection`'s docstring).
        connected: Whether the last connection test succeeded. Persisted
            so the Device tab can restore "connected -> show device UI"
            state across page reloads without re-testing every time.
    """

    host_type: HostType = "octo_klipper"
    printer_agent: PrinterAgent = "moonraker"
    print_host: str = ""
    device_ui: str = ""
    printhost_apikey: str = ""
    printhost_cafile: str = ""
    connected: bool = False


class ConnectionTestResult(BaseModel):
    """Result of a POST /api/device-connection/test call."""

    success: bool
    message: str
    klippy_state: Optional[str] = None


def _get_device_connection_path(session_id: str = "default") -> Path:
    """Path to the device_connection.yaml file for a given session."""
    config_dir = settings.user_workspace_root / session_id
    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir / "device_connection.yaml"


@router.get("/device-connection", response_model=DeviceConnection)
async def get_device_connection(session_id: str = "default") -> DeviceConnection:
    """Load the persisted device connection settings for a session."""
    config_path = _get_device_connection_path(session_id)

    if not config_path.exists():
        return DeviceConnection()

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if data is None:
            return DeviceConnection()
        return DeviceConnection(**data)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse device connection YAML: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load device connection: {e}")


@router.post("/device-connection", response_model=DeviceConnection)
async def save_device_connection(
    connection: DeviceConnection, session_id: str = "default"
) -> DeviceConnection:
    """Persist device connection settings for a session."""
    config_path = _get_device_connection_path(session_id)
    try:
        with open(config_path, "w", encoding="utf-8") as f:
            yaml.dump(connection.model_dump(), f, default_flow_style=False, allow_unicode=True)
        return connection
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save device connection: {e}")


@router.delete("/device-connection")
async def delete_device_connection(session_id: str = "default") -> dict:
    """Delete device connection settings (disconnect), for a session."""
    config_path = _get_device_connection_path(session_id)
    if config_path.exists():
        config_path.unlink()
    return {"message": "Device connection deleted successfully"}


def _is_http_success(status_code: int) -> bool:
    """
    Matches native's own success test exactly (slic3r/Utils/Http.cpp's
    `priv::ssl_complete`/request-completion handler): `http_status >= 200
    && http_status < 300` is success (routed to `completefn`); `>= 400` is
    an error (routed to `errorfn`). Native never special-cases exactly
    200 — Moonraker's `/server/files/upload` legitimately responds with
    201 Created on success, which a strict `== 200` check would wrongly
    reject as "Upload failed: host responded with HTTP 201" (the bug this
    helper fixes).
    """
    return 200 <= status_code < 300


def _normalize_moonraker_base_url(print_host: str) -> str:
    """
    Mirrors native's `Moonraker::make_url()` (slic3r/Utils/Moonraker.cpp):
    if `print_host` already has a scheme, use it as-is; otherwise assume
    plain HTTP (Moonraker's default, no TLS on the LAN).
    """
    host = print_host.strip().rstrip("/")
    if host.startswith("http://") or host.startswith("https://"):
        return host
    return f"http://{host}"


@router.post("/device-connection/test", response_model=ConnectionTestResult)
async def test_device_connection(connection: DeviceConnection) -> ConnectionTestResult:
    """
    Test connectivity to the configured printer host.

    Mirrors native's `Moonraker::test()` exactly: GETs `/server/info` and
    treats the connection as healthy as long as the JSON envelope is valid
    and contains `result.klippy_state` — the actual Klipper state (idle,
    error, etc) is informational only and does not gate success, matching
    the OctoPrint/PrusaLink convention of "can I reach this host?" rather
    than "is this printer currently ready to print?".

    Only `printer_agent == "moonraker"` is implemented; other agents
    return a clear failure message rather than silently doing nothing.
    `printhost_cafile` (custom CA cert) is accepted for parity with
    native's field set but not yet used to configure the TLS verification
    context for this test — flagged here rather than silently ignored.
    """
    if connection.printer_agent != "moonraker":
        return ConnectionTestResult(
            success=False,
            message=f"Printer agent '{connection.printer_agent}' is not supported yet.",
        )

    if not connection.print_host.strip():
        return ConnectionTestResult(success=False, message="Hostname, IP or URL is required.")

    base_url = _normalize_moonraker_base_url(connection.print_host)
    url = f"{base_url}/server/info"

    headers = {}
    if connection.printhost_apikey:
        # Moonraker's only defined auth header — never HTTP Basic/Digest,
        # matching Moonraker::set_auth()'s explicit comment on this.
        headers["X-Api-Key"] = connection.printhost_apikey

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers=headers)
    except httpx.TimeoutException:
        return ConnectionTestResult(success=False, message=f"Connection to {base_url} timed out.")
    except httpx.RequestError as e:
        return ConnectionTestResult(success=False, message=f"Could not connect to {base_url}: {e}")

    if not _is_http_success(response.status_code):
        return ConnectionTestResult(
            success=False,
            message=f"Host responded with HTTP {response.status_code}.",
        )

    try:
        body = response.json()
        klippy_state = body.get("result", {}).get("klippy_state")
    except ValueError:
        klippy_state = None

    if klippy_state is None:
        return ConnectionTestResult(
            success=False,
            message="The host responded but it doesn't look like Moonraker (missing result.klippy_state).",
        )

    return ConnectionTestResult(
        success=True,
        message="Connection to Moonraker is working correctly.",
        klippy_state=klippy_state,
    )


class UploadJobRequest(BaseModel):
    """
    Request body for POST /api/device-connection/upload.

    Mirrors native's "Send G-code to printer host" dialog
    (slic3r/GUI/PrintHostDialogs.cpp's PrintHostSendDialog): the user
    picks a job that has already produced a sliced gcode, an (editable,
    defaulted to the gcode's own filename) upload filename, and whether
    to also start the print immediately ("Upload" vs "Upload and Print" —
    native's wxID_OK vs wxID_YES buttons).
    """

    job_id: str
    filename: Optional[str] = Field(
        default=None,
        description="Filename to upload as. Defaults to the job's own plate_N.gcode name if omitted.",
    )
    start_print: bool = False


class UploadJobResult(BaseModel):
    """Result of a POST /api/device-connection/upload call."""

    success: bool
    message: str
    uploaded_filename: Optional[str] = None
    print_started: bool = False


@router.post("/device-connection/upload", response_model=UploadJobResult)
async def upload_job_to_printer(
    request: UploadJobRequest, db: aiosqlite.Connection = Depends(get_db)
) -> UploadJobResult:
    """
    Uploads a completed slice job's gcode to the connected Moonraker
    printer host, optionally starting the print immediately.

    Mirrors native's Moonraker::upload() (slic3r/Utils/Moonraker.cpp):
    POST multipart/form-data to /server/files/upload with fields `file`
    (the gcode bytes) and `root` ("gcodes", Moonraker's standard root —
    this app doesn't yet expose the storage-root picker native has, since
    Moonraker's default is virtually always correct), then, if
    `start_print` is set, POST /printer/print/start with the server's own
    reported `result.item.path` (falling back to the uploaded filename if
    that field is missing, matching native's exact fallback behavior).

    Reads the gcode server-side (reusing the same `resolve_and_guard`
    path-traversal guard as the outputs-download endpoint) rather than
    requiring the frontend to fetch-then-repost it, so this works
    identically regardless of auth/CORS on the job output route.
    """
    connection = await get_device_connection()
    if connection.printer_agent != "moonraker":
        return UploadJobResult(
            success=False,
            message=f"Printer agent '{connection.printer_agent}' is not supported yet.",
        )
    if not connection.print_host.strip():
        return UploadJobResult(success=False, message="No printer is connected.")

    cursor = await db.execute(
        "SELECT output_dir, status FROM jobs WHERE job_id = ?",
        (request.job_id,),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Job {request.job_id} not found")
    if row["status"] != "completed":
        return UploadJobResult(
            success=False,
            message=f"Job is not completed yet (status: {row['status']}).",
        )

    output_dir = Path(row["output_dir"])
    cursor = await db.execute(
        "SELECT filename FROM output_files WHERE job_id = ? AND filename LIKE '%.gcode' ORDER BY filename",
        (request.job_id,),
    )
    gcode_row = await cursor.fetchone()
    if not gcode_row:
        return UploadJobResult(success=False, message="This job has no sliced gcode to upload.")

    source_filename = gcode_row["filename"]
    try:
        gcode_path = resolve_and_guard(Path(source_filename), output_dir)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"Invalid output filename: {e}")
    if not gcode_path.exists():
        return UploadJobResult(success=False, message="The sliced gcode file is missing or expired.")

    upload_filename = (request.filename or source_filename).strip() or source_filename
    if not upload_filename.lower().endswith(".gcode"):
        upload_filename += ".gcode"

    base_url = _normalize_moonraker_base_url(connection.print_host)
    headers = {}
    if connection.printhost_apikey:
        headers["X-Api-Key"] = connection.printhost_apikey

    gcode_bytes = gcode_path.read_bytes()

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            upload_response = await client.post(
                f"{base_url}/server/files/upload",
                headers=headers,
                data={"root": "gcodes"},
                files={"file": (upload_filename, gcode_bytes, "text/x-gcode")},
            )
    except httpx.TimeoutException:
        return UploadJobResult(success=False, message=f"Upload to {base_url} timed out.")
    except httpx.RequestError as e:
        return UploadJobResult(success=False, message=f"Could not upload to {base_url}: {e}")

    if not _is_http_success(upload_response.status_code):
        return UploadJobResult(
            success=False,
            message=f"Upload failed: host responded with HTTP {upload_response.status_code}.",
        )

    try:
        upload_body = upload_response.json()
        uploaded_path = upload_body.get("result", {}).get("item", {}).get("path") or upload_filename
    except ValueError:
        uploaded_path = upload_filename

    if not request.start_print:
        return UploadJobResult(success=True, message="Upload complete.", uploaded_filename=uploaded_path)

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            start_response = await client.post(
                f"{base_url}/printer/print/start",
                headers={**headers, "Content-Type": "application/json"},
                json={"filename": uploaded_path},
            )
    except httpx.TimeoutException:
        return UploadJobResult(
            success=False,
            message="Upload succeeded, but starting the print timed out.",
            uploaded_filename=uploaded_path,
        )
    except httpx.RequestError as e:
        return UploadJobResult(
            success=False,
            message=f"Upload succeeded, but starting the print failed: {e}",
            uploaded_filename=uploaded_path,
        )

    if not _is_http_success(start_response.status_code):
        return UploadJobResult(
            success=False,
            message=f"Upload succeeded, but starting the print failed (HTTP {start_response.status_code}).",
            uploaded_filename=uploaded_path,
        )

    return UploadJobResult(
        success=True,
        message="Upload complete and print started.",
        uploaded_filename=uploaded_path,
        print_started=True,
    )
