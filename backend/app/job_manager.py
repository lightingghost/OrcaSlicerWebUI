"""
Job execution manager for OrcaSlicer CLI subprocess orchestration.

This module implements the JobManager class which handles:
- Concurrent job execution with configurable semaphore limits
- FIFO job queue for managing pending jobs
- Subprocess spawning with timeout watchdog
- Job status tracking and database updates
- CLI stdout parsing and progress event broadcasting

Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 7.2, 7.4, 7.5, 7.6
"""

import asyncio
import json
import logging
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import aiosqlite

from app.cli_builder import build_cli_args, resolve_and_guard
from app.config import Settings
from app.threemf_io import ProjectObject, parse_stl_bytes, write_3mf

logger = logging.getLogger(__name__)


def _build_positioned_project_3mf(
    instances: list[dict[str, Any]],
    file_paths: dict[str, Path],
    output_dir: Path,
) -> Path:
    """
    Build a single .3mf snapshotting every plate object at its LIVE
    position/rotation/scale (as captured from the Three.js viewport at
    submit time — see JobRequestModel.instances's doc comment), and
    return its path.

    Why this exists: this app never sent per-object placement to the CLI
    at all — Slice/Export always passed the raw uploaded STL files as
    bare positional CLI arguments (see cli_builder.py's "Input files"
    section), each landing at whatever raw X/Y its own mesh data happens
    to occupy. That's harmless for a single object (nothing else on the
    bed to overlap with), but reliably fails for 2+ objects with
    CLI_OBJECTS_PARTLY_INSIDE ("Some objects are located over the
    boundary of the heated bed") once arrange is disabled by default at
    slice time (see transformSlice.ts's DEFAULT_TRANSFORMS.arrange — this
    became a live bug only after that default changed from "always
    auto-arrange" to "off", since auto-arrange used to paper over exactly
    this gap). Building an actual positioned 3mf and passing THAT as the
    CLI's sole input — instead of N raw STL args — makes the CLI slice
    exactly the plate the user sees in the viewport, matching what a
    native OrcaSlicer session (which always saves/loads real object
    positions in its own 3mf project state) would do.

    Reuses threemf_io.py (the same module backing the "Download Project"
    feature — see routers/projects.py) rather than any CLI round-trip,
    since this is a pure data transformation, not something requiring the
    CLI's own logic (unlike Arrange's real nesting algorithm).

    Raises:
        ValueError: an instance's file_id has no known storage path, the
            file is missing on disk, or its source isn't an STL (the only
            format threemf_io.py's mesh reader currently supports — same
            limitation as POST /api/projects/export).
    """
    project_objects: list[ProjectObject] = []
    for instance in instances:
        file_id = instance["file_id"]
        stored_path = file_paths.get(file_id)
        if stored_path is None:
            raise ValueError(f"File not found: {file_id}")
        if stored_path.suffix.lower() != ".stl":
            raise ValueError(
                f"Only STL-sourced plate objects can be sliced/exported with live "
                f"positioning right now; unsupported file: {stored_path.name}"
            )
        if not stored_path.exists():
            raise ValueError(f"File missing on disk: {stored_path.name}")

        mesh = parse_stl_bytes(stored_path.read_bytes())
        project_objects.append(
            ProjectObject(
                name=stored_path.name,
                mesh=mesh,
                x=instance.get("x", 0.0),
                y=instance.get("y", 0.0),
                z=instance.get("z", 0.0),
                qx=instance.get("qx", 0.0),
                qy=instance.get("qy", 0.0),
                qz=instance.get("qz", 0.0),
                qw=instance.get("qw", 1.0),
                sx=instance.get("sx", 1.0),
                sy=instance.get("sy", 1.0),
                sz=instance.get("sz", 1.0),
                # This object's own override DELTA (see
                # JobInstancePlacementModel.config_overrides's doc
                # comment for why this deliberately does NOT include
                # anything inherited from Global) — carried through
                # unchanged into the plate snapshot 3mf's
                # Metadata/model_settings.config, which is what makes
                # the actual OrcaSlicer CLI apply it only to THIS object
                # rather than the whole plate.
                config_overrides=dict(instance.get("config_overrides") or {}),
            )
        )

    data = write_3mf(project_objects)
    snapshot_path = output_dir / "_plate_snapshot.3mf"
    snapshot_path.write_bytes(data)
    return snapshot_path


# Matches PrintConfig.cpp's own default_value for "filename_format"
# (confirmed against data/parameters.json) — used whenever a job's
# cli_args don't carry an explicit `--filename-format=...` override
# (i.e. the user never touched that field), since native OrcaSlicer
# applies this default naming scheme unconditionally, not only when
# explicitly configured. See _apply_filename_format's doc comment for
# why the CLI itself never actually performs this substitution.
DEFAULT_FILENAME_FORMAT = "{input_filename_base}_{filament_type[initial_tool]}_{print_time}.gcode"

# Matches a `{placeholder}` or `{placeholder[index]}` token in a
# filename_format string (PrintConfig.cpp's PlaceholderParser syntax).
# The `[index]` suffix (e.g. "[initial_tool]") is captured but discarded
# by _substitute_filename_format — this app only ever resolves a single
# value per placeholder (there's exactly one "first extruder"/plate per
# completed slice job here), so the index itself carries no additional
# information to act on.
_FILENAME_FORMAT_PLACEHOLDER_RE = re.compile(r"\{([a-zA-Z_]+)(?:\[[^\]]*\])?\}")


def _extract_input_file_paths(cli_args: list[str]) -> list[str]:
    """
    Extract the positional input file arguments from an already-built
    cli_args list — everything between the CLI binary path (index 0) and
    the first `--flag` argument. Relies on build_cli_args's fixed
    ordering (input files always precede the action flag, which is
    always the first `--`-prefixed argument — see build_cli_args's
    "1. Input files" / "2. Action flag" sections).
    """
    paths = []
    for arg in cli_args[1:]:
        if arg.startswith("--"):
            break
        paths.append(arg)
    return paths


def _extract_gcode_config_value(gcode_text: str, key: str) -> Optional[str]:
    """
    Extract a `; {key} = value` line from a sliced gcode's own
    CONFIG_BLOCK footer (a full dump of every config option's resolved
    value that the CLI always writes — e.g. "; filament_type = PETG",
    "; estimated printing time (normal mode) = 15m 47s"). Returns the
    trimmed value, or None if the key isn't present in this file.
    """
    match = re.search(rf"^; {re.escape(key)} = (.+)$", gcode_text, re.MULTILINE)
    return match.group(1).strip() if match else None


def _short_time(dhms: str) -> str:
    """
    Port of native OrcaSlicer's `short_time()` (libslic3r/Utils.hpp):
    parses a "DDd HHh MMm SSs"-style duration string (the exact format
    the gcode footer's "estimated printing time (normal mode)" line
    uses — see Utils.hpp's get_time_dhms, which produces that string in
    the first place) and re-renders it rounded to whole minutes (once
    days or hours are involved) with spaces removed, matching the
    {print_time} placeholder's actual on-disk naming convention (e.g.
    "15m 47s" -> "15m47s", confirmed against a real native-named export:
    box_PETG_15m47s.gcode).
    """
    days = hours = minutes = seconds = 0
    f_seconds = 0.0

    if "d" in dhms:
        m = re.match(r"(\d+)d\s+(\d+)h\s+(\d+)m\s+(\d+)s", dhms)
        if m:
            days, hours, minutes, seconds = (int(g) for g in m.groups())
    elif "h" in dhms:
        m = re.match(r"(\d+)h\s+(\d+)m\s+(\d+)s", dhms)
        if m:
            hours, minutes, seconds = (int(g) for g in m.groups())
    elif "m" in dhms:
        m = re.match(r"(\d+)m\s+(\d+)s", dhms)
        if m:
            minutes, seconds = (int(g) for g in m.groups())
    elif "s" in dhms:
        m = re.match(r"([\d.]+)s", dhms)
        if m:
            f_seconds = float(m.group(1))
            seconds = int(f_seconds)

    # Round to full minutes once days or hours are involved (matches
    # native's own rounding rule exactly).
    if days + hours > 0 and seconds >= 30:
        minutes += 1
        if minutes == 60:
            minutes = 0
            hours += 1
            if hours == 24:
                hours = 0
                days += 1

    if days > 0:
        return f"{days}d{hours}h{minutes}m"
    if hours > 0:
        return f"{hours}h{minutes}m"
    if minutes > 0:
        return f"{minutes}m{seconds}s"
    if seconds >= 1:
        return f"{seconds}s"
    if 0 < f_seconds < 1:
        return "<1s"
    return "0s"


def _substitute_filename_format(
    filename_format: str,
    input_filename_base: str,
    filament_type: str,
    print_time: str,
) -> str:
    """
    Minimal PlaceholderParser-style substitution covering the three
    placeholders filename_format's own tooltip/default value documents:
    {input_filename_base}, {filament_type[N]} (N is always ignored here
    — see _FILENAME_FORMAT_PLACEHOLDER_RE's doc comment), and
    {print_time}. Any other placeholder is left as literal text rather
    than raising, since a partial substitution is more useful than
    failing an already-successful slice job over an unsupported
    placeholder — native's own PlaceholderParser supports substantially
    more expressions (arithmetic, conditionals, other config keys) than
    this app resolves.
    """
    values = {
        "input_filename_base": input_filename_base,
        "filament_type": filament_type,
        "print_time": print_time,
    }

    def replace(match: "re.Match[str]") -> str:
        return values.get(match.group(1), match.group(0))

    return _FILENAME_FORMAT_PLACEHOLDER_RE.sub(replace, filename_format)


def _extract_cli_flag_value(cli_args: list[str], flag: str) -> Optional[str]:
    """
    Find `--{flag}=value` in an already-built cli_args list and return its
    value, or None if the flag isn't present. Values are taken verbatim
    (only split on the FIRST '=') since cli_builder.py appends parameter
    overrides as `--{cli-flag}={value}` in a single argv element (no shell
    involved — see build_cli_args), so the value is preserved exactly as
    the user typed it, including any '=' it may itself contain.
    """
    prefix = f"--{flag}="
    for arg in cli_args:
        if arg.startswith(prefix):
            return arg[len(prefix):]
    return None


def _extract_post_process_from_settings_file(cli_args: list[str]) -> Optional[str]:
    """
    Fall back to reading `post_process` directly out of the resolved
    process settings file passed via `--load-settings`, for jobs where the
    value was saved INTO a process config rather than left as a live,
    unsaved Process-panel edit.

    `post_process` is deliberately never included in `parameter_overrides`
    (cli_builder.py's own doc comment: process-panel edits go through
    `--{flag}=value` CLI args, which is what `_extract_cli_flag_value`
    reads) once the user has saved it into the profile itself — saving
    moves the value into the profile's own JSON (see
    ProcessSelector.tsx's buildSavePayload / parameterSlice.ts's "changed
    vs profileDefaults" comparison, which is what makes the Reset button
    correctly stop showing "changed" after a save). The value still
    reaches the CLI just fine (the resolved settings file IS loaded via
    --load-settings, so slicing itself picks it up) — but this app's own
    post-processing step (`_run_post_process_scripts`, needed because the
    headless CLI binary never runs scripts itself) only ever looked at
    the CLI flag, so a saved-and-reselected `post_process` value was
    silently never executed. This reads the same settings file the CLI
    itself loads, so it works whether the value came from a live
    parameter_overrides edit (though that path is covered by
    _extract_cli_flag_value already) or from a saved config.

    `--load-settings` always lists the printer profile (if any) followed
    by the process profile (see cli_builder.py's build_cli_args) — the
    process path is therefore always the LAST entry in the
    semicolon-joined list, whether or not a printer path is also present.
    """
    # Unlike `--post-process=value` (a single argv element,
    # `_extract_cli_flag_value`'s form), `--load-settings` is built as TWO
    # separate argv elements — `--load-settings` followed by its value as
    # its own element (see cli_builder.py's build_cli_args:
    # `args.extend(["--load-settings", ";".join(load_settings_paths)])`)
    # — so it needs its own lookup here rather than reusing
    # _extract_cli_flag_value.
    settings_value: Optional[str] = None
    for i, arg in enumerate(cli_args):
        if arg == "--load-settings" and i + 1 < len(cli_args):
            settings_value = cli_args[i + 1]
            break
    if not settings_value:
        return None
    paths = [p for p in settings_value.split(";") if p]
    if not paths:
        return None
    process_path = Path(paths[-1])
    try:
        with open(process_path, "r", encoding="utf-8") as f:
            resolved = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(resolved, dict):
        return None

    value = resolved.get("post_process")
    if isinstance(value, str):
        return value or None
    if isinstance(value, list):
        # Native's own on-disk representation is a coStrings list (see
        # PrintConfig.cpp/Config.hpp's ConfigOptionStrings) — join with
        # ';', the same separator _parse_post_process_scripts already
        # accepts, so either representation resolves identically.
        joined = ";".join(str(v) for v in value if str(v).strip())
        return joined or None
    return None


def _parse_post_process_scripts(value: str) -> list[str]:
    """
    Split a `post_process` parameter override value into individual script
    invocations (each may itself be a full command line, e.g.
    "/path/to/script.sh --flag").

    Native OrcaSlicer's own config option tooltip
    (PrintConfig.cpp: def->tooltip for "post_process") documents ';' as the
    separator for multiple scripts, but the option's actual runtime
    representation (a coStrings list, gui_flags="serialized", multiline
    textarea) is split on newlines by PostProcessor.cpp's
    run_post_process_scripts (`boost::split(lines, scripts,
    boost::is_any_of("\\r\\n"))`). This app's own parameter UI renders
    `post_process` as a single-line text field (see ParameterField.tsx —
    it's typed as `string` there, not a list), so split on BOTH
    separators here rather than picking just one, so either convention the
    user types works.
    """
    entries = re.split(r'[;\r\n]+', value)
    return [entry.strip() for entry in entries if entry.strip()]


async def _run_post_process_script(script_command: str, gcode_path: Path) -> tuple[int, str]:
    """
    Run one post-processing script against a gcode file, mirroring native
    OrcaSlicer's own script invocation (PostProcessor.cpp's run_script on
    POSIX): execute through the user's default shell (or /bin/sh) so
    script_command may itself be a full command line (e.g. a script path
    plus its own flags), with gcode_path appended as a single,
    shell-quoted extra argument — exactly matching native's own
    single-quote escaping of the gcode path before invocation. This is
    also why addMD5.sh's own `$1` argument works unmodified: native's
    contract is "scripts will be passed the absolute path to the G-code
    file as the first argument" (see PrintConfig.cpp's post_process
    tooltip), which this replicates.

    Returns (exit_code, combined_stdout_stderr).
    """
    shell = os.environ.get("SHELL") or "/bin/sh"
    quoted_gcode = "'" + str(gcode_path).replace("'", "'\\''") + "'"
    full_command = f"{script_command} {quoted_gcode}"

    process = await asyncio.create_subprocess_exec(
        shell, "-c", full_command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    stdout, _ = await process.communicate()
    return process.returncode, stdout.decode("utf-8", errors="replace")


def _build_subprocess_env(orca_cli_path: Path) -> dict[str, str]:
    """
    Build the environment for the OrcaSlicer CLI subprocess.

    The distributed OrcaSlicer AppImage bundles its own shared libraries
    (under an `orca-runtime`/`lib` directory next to the AppImage's `bin/`)
    and only resolves them when run through its `AppRun`/`orca-slicer-env`
    wrapper script, which sets LD_LIBRARY_PATH before exec'ing the real
    binary. Since job_manager invokes the binary directly (not through that
    wrapper, so its stdout stays a clean pipe for progress parsing), the
    same LD_LIBRARY_PATH setup must be replicated here or the process fails
    immediately with "error while loading shared libraries" and every job
    fails regardless of how correct the CLI arguments are.

    Mirrors the relevant part of the AppImage's `libexec/orca-slicer-env`:
    prepend `<AppDir>/lib/orca-runtime` (if present) and `<AppDir>/bin` to
    LD_LIBRARY_PATH, where AppDir is the orca_cli_path binary's grandparent
    ('.../bin/orca-slicer' -> AppDir is '...'). Falls back to a no-op
    (inherited environment) if these directories don't exist — e.g. a
    system-installed OrcaSlicer binary that doesn't need this.
    """
    env = os.environ.copy()

    app_dir = orca_cli_path.resolve().parent.parent
    bin_dir = app_dir / "bin"
    runtime_lib_dir = app_dir / "lib" / "orca-runtime"

    ld_library_path_parts = []
    if runtime_lib_dir.is_dir():
        ld_library_path_parts.append(str(runtime_lib_dir))
    if bin_dir.is_dir():
        ld_library_path_parts.append(str(bin_dir))

    if ld_library_path_parts:
        existing = env.get("LD_LIBRARY_PATH")
        if existing:
            ld_library_path_parts.append(existing)
        env["LD_LIBRARY_PATH"] = ":".join(ld_library_path_parts)

    return env


class JobManager:
    """
    Manages job submission, queueing, and execution with concurrency control.
    
    The JobManager enforces a maximum concurrent jobs limit using an asyncio
    Semaphore, maintains a FIFO queue of pending jobs, spawns subprocess for
    CLI execution, implements a timeout watchdog to terminate hung processes,
    and streams progress events via WebSocket.
    
    Attributes:
        config: Application settings (CLI path, workspace, timeouts, etc.)
        db_path: Path to SQLite database file
        ws_manager: WebSocket manager for broadcasting progress events
        semaphore: Limits concurrent job execution
        queue: FIFO queue for pending job requests
        active_jobs: Dict mapping job_id to asyncio Task for cancellation
    """
    
    def __init__(self, config: Settings, db_path: Path, ws_manager: Optional[Any] = None):
        """
        Initialize the JobManager.
        
        Args:
            config: Application settings instance
            db_path: Path to SQLite database file
            ws_manager: WebSocketManager instance for progress broadcasting (optional)
        """
        self.config = config
        self.db_path = db_path
        self.ws_manager = ws_manager
        
        # Semaphore to limit concurrent jobs
        self.semaphore = asyncio.Semaphore(config.max_concurrent_jobs)
        
        # FIFO queue for job requests
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        
        # Track active jobs for cancellation
        self.active_jobs: dict[str, asyncio.Task] = {}
        
        # Worker task to process queue
        self._worker_task: asyncio.Task | None = None
    
    async def start(self) -> None:
        """Start the background worker task that processes the job queue."""
        if self._worker_task is None or self._worker_task.done():
            self._worker_task = asyncio.create_task(self._process_queue())
            logger.info("JobManager worker started")
    
    async def stop(self) -> None:
        """Stop the background worker and cancel all active jobs."""
        # Cancel all active jobs
        for job_id, task in list(self.active_jobs.items()):
            if not task.done():
                task.cancel()
                logger.info(f"Cancelled job {job_id} during shutdown")
        
        # Wait for all active jobs to finish
        if self.active_jobs:
            await asyncio.gather(*self.active_jobs.values(), return_exceptions=True)
        
        # Cancel the worker task
        if self._worker_task and not self._worker_task.done():
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
        
        logger.info("JobManager stopped")
    
    async def submit(self, job_request: dict[str, Any], session_id: str) -> str:
        """
        Submit a job for execution.
        
        Creates a job record in the database with status 'queued', enqueues the
        job_id for processing by the worker, and returns the job_id immediately.
        
        Args:
            job_request: Dictionary containing all job parameters (files, profiles,
                        transforms, parameters, etc.)
            session_id: Session identifier for file resolution
            
        Returns:
            The newly created job_id (UUID string)
            
        Requirements: 6.1, 6.6
        """
        # Generate unique job ID
        job_id = str(uuid.uuid4())
        
        # Prepare job directories
        output_dir = self.config.jobs_output_dir / job_id / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Resolve each file_id to its actual on-disk storage_path (recorded
        # by the upload endpoint as session_uploads_dir/{session_id}/uploads/
        # {file_id}.{ext}) rather than assuming a fixed shape — file_ids are
        # also used for misc.load_custom_gcodes_file_id, so build_cli_args
        # needs a lookup covering every file_id referenced by the job, not
        # just file_ids itself.
        file_ids_to_resolve = set(job_request.get("file_ids", []))
        custom_gcodes_id = (job_request.get("misc") or {}).get("load_custom_gcodes_file_id")
        if custom_gcodes_id:
            file_ids_to_resolve.add(custom_gcodes_id)
        
        file_paths: dict[str, Path] = {}
        if file_ids_to_resolve:
            async with aiosqlite.connect(self.db_path) as db:
                await db.execute("PRAGMA foreign_keys = ON")
                for file_id in file_ids_to_resolve:
                    cursor = await db.execute(
                        "SELECT storage_path FROM files WHERE file_id = ? AND session_id = ?",
                        (file_id, session_id),
                    )
                    row = await cursor.fetchone()
                    if row is None:
                        raise ValueError(f"File not found: {file_id}")
                    file_paths[file_id] = Path(row[0])

        # If the request carries live per-object placement (see
        # JobRequestModel.instances's doc comment / _build_positioned_project_3mf's
        # doc comment for why this exists), build a single positioned 3mf
        # snapshot of the plate and slice/export THAT instead of the raw,
        # unpositioned file_ids — this is what makes the CLI operate on
        # exactly what the viewport shows rather than each file's own
        # raw mesh-native origin.
        instances = job_request.get("instances")
        effective_job_request = job_request
        effective_file_paths = file_paths
        if instances:
            snapshot_path = _build_positioned_project_3mf(instances, file_paths, output_dir)
            # Replace the job's file_ids with a single synthetic id
            # pointing at the snapshot — build_cli_args only ever reads
            # file_ids through file_paths, so this substitution is
            # transparent to it and to every other part of the job
            # pipeline (parameter overrides, transforms, etc. are
            # unaffected since they don't reference file_ids at all).
            snapshot_file_id = f"_plate_snapshot_{job_id}"
            effective_job_request = {**job_request, "file_ids": [snapshot_file_id]}
            effective_file_paths = {**file_paths, snapshot_file_id: snapshot_path}

        # Build CLI args (may raise ValueError on path validation)
        cli_args = build_cli_args(effective_job_request, self.config, effective_file_paths, output_dir)
        
        # Create job record in database
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("PRAGMA foreign_keys = ON")
            
            await db.execute(
                """
                INSERT INTO jobs (
                    job_id, session_id, submitted_at, status, action_type,
                    cli_args, output_dir
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    session_id,
                    datetime.utcnow().isoformat(),
                    "queued",
                    job_request["action"],
                    json.dumps(cli_args),
                    str(output_dir),
                ),
            )
            await db.commit()
        
        # Enqueue job for processing
        await self.queue.put(job_id)
        
        logger.info(
            f"Job {job_id} submitted and queued",
            extra={"job_id": job_id, "action": job_request["action"]},
        )
        
        return job_id
    
    async def cancel(self, job_id: str) -> bool:
        """
        Cancel a queued or running job.
        
        Args:
            job_id: The job to cancel
            
        Returns:
            True if job was cancelled, False if job not found or already terminal
        """
        # Check if job is active
        if job_id in self.active_jobs:
            task = self.active_jobs[job_id]
            if not task.done():
                task.cancel()
                logger.info(f"Cancelled active job {job_id}")
                return True
        
        # If not active, check if it's queued and mark as failed
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("PRAGMA foreign_keys = ON")
            
            cursor = await db.execute(
                "SELECT status FROM jobs WHERE job_id = ?",
                (job_id,),
            )
            row = await cursor.fetchone()
            
            if row and row[0] == "queued":
                await db.execute(
                    """
                    UPDATE jobs
                    SET status = 'failed',
                        completed_at = ?,
                        error_message = 'Job cancelled by user'
                    WHERE job_id = ?
                    """,
                    (datetime.utcnow().isoformat(), job_id),
                )
                await db.commit()
                logger.info(f"Marked queued job {job_id} as cancelled")
                return True
        
        return False
    
    async def _process_queue(self) -> None:
        """
        Background worker that processes jobs from the queue.
        
        Continuously pulls job_ids from the queue and spawns execution tasks.
        The semaphore ensures we never exceed max_concurrent_jobs.
        """
        logger.info("Job queue processor started")
        
        while True:
            try:
                # Get next job from queue (blocks if empty)
                job_id = await self.queue.get()
                
                # Create execution task (will wait for semaphore inside)
                task = asyncio.create_task(self._execute(job_id))
                self.active_jobs[job_id] = task
                
                # Clean up completed tasks
                def cleanup_task(job_id: str, task: asyncio.Task) -> None:
                    if job_id in self.active_jobs:
                        del self.active_jobs[job_id]
                
                task.add_done_callback(lambda t: cleanup_task(job_id, t))
                
            except asyncio.CancelledError:
                logger.info("Job queue processor cancelled")
                break
            except Exception as e:
                logger.error(f"Error in queue processor: {e}", exc_info=True)
                # Continue processing despite errors
    
    def _parse_progress_line(self, line: str, job_id: str) -> Optional[dict[str, Any]]:
        """
        Parse a CLI output line for progress information.
        
        OrcaSlicer CLI outputs progress in various formats. This method attempts
        to extract progress information and warnings from stdout lines.
        
        Args:
            line: Raw line from CLI stdout
            job_id: The job identifier for event tagging
            
        Returns:
            Event dict if progress/warning detected, None otherwise
            
        Requirements: 7.2, 7.4
        """
        line = line.strip()
        if not line:
            return None
        
        # Pattern 1: Warning detection (case-insensitive) - check first to avoid false positives
        if re.search(r'\bwarn(ing)?\b', line, re.IGNORECASE):
            return {
                "type": "warning",
                "job_id": job_id,
                "warning": line,
                "timestamp": datetime.utcnow().isoformat(),
            }
        
        # Pattern 2: Plate progress (e.g., "Plate 1/3: 50%") - more specific than simple percentage
        plate_match = re.search(r'[Pp]late\s+(\d+)/(\d+)[:\s]+(\d+)%', line)
        if plate_match:
            plate_index = int(plate_match.group(1)) - 1  # Convert to 0-based
            plate_count = int(plate_match.group(2))
            plate_percent = int(plate_match.group(3))
            # Estimate total percent based on plate progress
            total_percent = int((plate_index * 100 + plate_percent) / plate_count)
            return {
                "type": "progress",
                "job_id": job_id,
                "plate_index": plate_index,
                "plate_count": plate_count,
                "plate_percent": plate_percent,
                "total_percent": total_percent,
                "message": line,
                "timestamp": datetime.utcnow().isoformat(),
            }
        
        # Pattern 3: Progress percentage (e.g., "Slicing: 45%", "Processing: 75%")
        percent_match = re.search(r'(\d+)%', line)
        if percent_match:
            percent = int(percent_match.group(1))
            return {
                "type": "progress",
                "job_id": job_id,
                "plate_index": 0,  # Default to first plate
                "plate_count": 1,  # Default to single plate
                "plate_percent": percent,
                "total_percent": percent,
                "message": line,
                "timestamp": datetime.utcnow().isoformat(),
            }
        
        # Pattern 4: Status messages (informational)
        status_keywords = [
            'slicing', 'processing', 'generating', 'analyzing',
            'preparing', 'loading', 'saving', 'exporting'
        ]
        if any(keyword in line.lower() for keyword in status_keywords):
            return {
                "type": "progress",
                "job_id": job_id,
                "plate_index": 0,
                "plate_count": 1,
                "plate_percent": 0,
                "total_percent": 0,
                "message": line,
                "timestamp": datetime.utcnow().isoformat(),
            }
        
        return None
    
    async def _broadcast_queued_event(self, job_id: str, queue_position: int) -> None:
        """
        Broadcast a QueuedEvent to WebSocket clients.
        
        Args:
            job_id: The queued job identifier
            queue_position: Position in the queue (1-based)
        """
        if self.ws_manager:
            event = {
                "type": "queued",
                "job_id": job_id,
                "queue_position": queue_position,
                "timestamp": datetime.utcnow().isoformat(),
            }
            await self.ws_manager.broadcast(job_id, event)
    
    async def _broadcast_started_event(self, job_id: str) -> None:
        """
        Broadcast a StartedEvent to WebSocket clients.
        
        Args:
            job_id: The started job identifier
        """
        if self.ws_manager:
            event = {
                "type": "started",
                "job_id": job_id,
                "timestamp": datetime.utcnow().isoformat(),
            }
            await self.ws_manager.broadcast(job_id, event)
    
    async def _broadcast_completed_event(self, job_id: str, output_files: list[dict]) -> None:
        """
        Broadcast a CompletedEvent to WebSocket clients.
        
        Args:
            job_id: The completed job identifier
            output_files: List of output file summaries
        """
        if self.ws_manager:
            event = {
                "type": "completed",
                "job_id": job_id,
                "output_files": output_files,
                "timestamp": datetime.utcnow().isoformat(),
            }
            await self.ws_manager.broadcast(job_id, event)
    
    async def _broadcast_failed_event(self, job_id: str, exit_code: int, error_message: str) -> None:
        """
        Broadcast a FailedEvent to WebSocket clients.
        
        Args:
            job_id: The failed job identifier
            exit_code: Process exit code
            error_message: Error description
        """
        if self.ws_manager:
            event = {
                "type": "failed",
                "job_id": job_id,
                "exit_code": exit_code,
                "error_message": error_message,
                "timestamp": datetime.utcnow().isoformat(),
            }
            await self.ws_manager.broadcast(job_id, event)
    
    async def _broadcast_timed_out_event(self, job_id: str, timeout_seconds: int) -> None:
        """
        Broadcast a TimedOutEvent to WebSocket clients.
        
        Args:
            job_id: The timed-out job identifier
            timeout_seconds: The timeout duration that was exceeded
        """
        if self.ws_manager:
            event = {
                "type": "timed_out",
                "job_id": job_id,
                "timeout_seconds": timeout_seconds,
                "timestamp": datetime.utcnow().isoformat(),
            }
            await self.ws_manager.broadcast(job_id, event)
    
    async def _execute(self, job_id: str) -> None:
        """
        Execute a single job with timeout watchdog.
        
        Acquires the semaphore, retrieves job details from database, spawns the
        CLI subprocess, monitors for completion or timeout, and updates the
        database with results.
        
        Args:
            job_id: The job to execute
            
        Requirements: 6.2, 6.3, 6.5
        """
        # Acquire semaphore (blocks if at max concurrent jobs)
        async with self.semaphore:
            try:
                # Retrieve job details from database
                async with aiosqlite.connect(self.db_path) as db:
                    await db.execute("PRAGMA foreign_keys = ON")
                    db.row_factory = aiosqlite.Row
                    
                    cursor = await db.execute(
                        """
                        SELECT job_id, session_id, cli_args, output_dir, action_type
                        FROM jobs
                        WHERE job_id = ?
                        """,
                        (job_id,),
                    )
                    row = await cursor.fetchone()
                    
                    if not row:
                        logger.error(f"Job {job_id} not found in database")
                        return
                    
                    cli_args_json = row["cli_args"]
                    output_dir = row["output_dir"]
                    action_type = row["action_type"]
                    
                    # Update status to running
                    await db.execute(
                        """
                        UPDATE jobs
                        SET status = 'running', started_at = ?
                        WHERE job_id = ?
                        """,
                        (datetime.utcnow().isoformat(), job_id),
                    )
                    await db.commit()
                
                cli_args = json.loads(cli_args_json)
                
                # Record start time for CLI invocation logging
                start_time = datetime.utcnow().isoformat()
                
                # Broadcast started event
                await self._broadcast_started_event(job_id)
                
                logger.info(
                    f"Starting job {job_id}",
                    extra={
                        "event": "cli_invocation_start",
                        "job_id": job_id,
                        "command_args": cli_args,
                        "start_time": start_time,
                    },
                )
                
                # Create log file for CLI output
                log_file_path = Path(output_dir).parent / "cli.log"
                
                # Spawn CLI subprocess with timeout
                try:
                    async with asyncio.timeout(self.config.job_timeout_seconds):
                        process = await asyncio.create_subprocess_exec(
                            *cli_args,
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.STDOUT,
                            cwd=str(output_dir),
                            env=_build_subprocess_env(self.config.orca_cli_path),
                        )
                        
                        # Stream output to log file, collect lines, and parse for progress
                        output_lines = []
                        with open(log_file_path, "wb") as log_file:
                            while True:
                                line = await process.stdout.readline()
                                if not line:
                                    break
                                
                                # Write to log file
                                log_file.write(line)
                                
                                # Decode and parse line
                                decoded_line = line.decode("utf-8", errors="replace")
                                output_lines.append(decoded_line)
                                
                                # Parse for progress and broadcast events
                                event = self._parse_progress_line(decoded_line, job_id)
                                if event and self.ws_manager:
                                    await self.ws_manager.broadcast(job_id, event)
                        
                        # Wait for process to complete
                        exit_code = await process.wait()
                
                except asyncio.TimeoutError:
                    # Timeout watchdog triggered - terminate process
                    end_time = datetime.utcnow().isoformat()
                    logger.warning(
                        f"Job {job_id} timed out after {self.config.job_timeout_seconds}s"
                    )
                    
                    # Try graceful termination first, then kill
                    try:
                        process.terminate()
                        await asyncio.wait_for(process.wait(), timeout=5.0)
                    except asyncio.TimeoutError:
                        process.kill()
                        await process.wait()
                    
                    # Update database with timeout status
                    async with aiosqlite.connect(self.db_path) as db:
                        await db.execute("PRAGMA foreign_keys = ON")
                        await db.execute(
                            """
                            UPDATE jobs
                            SET status = 'timed_out',
                                completed_at = ?,
                                error_message = ?
                            WHERE job_id = ?
                            """,
                            (
                                end_time,
                                f"Job exceeded timeout of {self.config.job_timeout_seconds} seconds",
                                job_id,
                            ),
                        )
                        await db.commit()
                    
                    # Broadcast timed out event
                    await self._broadcast_timed_out_event(job_id, self.config.job_timeout_seconds)
                    
                    # Log complete CLI invocation details for timeout
                    logger.info(
                        f"CLI invocation completed (timed out) for job {job_id}",
                        extra={
                            "event": "cli_invocation",
                            "job_id": job_id,
                            "command_args": cli_args,
                            "start_time": start_time,
                            "end_time": end_time,
                            "exit_code": None,
                            "status": "timed_out",
                        },
                    )
                    return
                
                # Process completed normally (with or without error)
                end_time = datetime.utcnow().isoformat()
                
                # Log complete CLI invocation details
                logger.info(
                    f"CLI invocation completed for job {job_id} with exit code {exit_code}",
                    extra={
                        "event": "cli_invocation",
                        "job_id": job_id,
                        "command_args": cli_args,
                        "start_time": start_time,
                        "end_time": end_time,
                        "exit_code": exit_code,
                    },
                )
                
                # Determine job status based on exit code
                if exit_code == 0:
                    status = "completed"
                    error_message = None

                    # Rename output gcode(s) per filename_format BEFORE
                    # running post-processing scripts below, matching
                    # native's own pipeline order (PrintBase::output_filename
                    # resolves the final path before
                    # run_post_process_scripts ever executes — see
                    # PostProcessor.cpp) — so a script like addMD5.sh sees
                    # the file already under its correctly-named path,
                    # exactly as it would on native.
                    await self._apply_filename_format(job_id, cli_args, Path(output_dir))

                    # Run any configured post-processing script(s) against
                    # every gcode this job produced. Native OrcaSlicer's
                    # desktop GUI does this itself (BackgroundSlicingProcess.cpp
                    # calling run_post_process_scripts after export), but the
                    # headless CLI binary this app invokes has that call
                    # commented out (OrcaSlicer.cpp's --slice path) — the
                    # `post_process` config option is accepted and echoed by
                    # the CLI but silently never executed. This replicates it
                    # here instead, same pattern as _splice_thumbnail_into_gcode
                    # in routers/jobs.py working around the CLI's other
                    # GUI-only thumbnail-callback gap.
                    # Prefer a live, unsaved Process-panel edit (CLI flag)
                    # over the resolved settings file — matches
                    # cli_builder.py's own precedence (parameter_overrides
                    # always reflects the CURRENT in-memory value, which
                    # is authoritative over whatever the profile file on
                    # disk says, e.g. mid-edit before the user has saved).
                    # Only fall back to the settings file when there's no
                    # live override at all, i.e. the value was saved into
                    # the profile itself (see
                    # _extract_post_process_from_settings_file's doc
                    # comment for why the CLI flag alone isn't enough).
                    post_process_value = (
                        _extract_cli_flag_value(cli_args, "post-process")
                        or _extract_post_process_from_settings_file(cli_args)
                    )
                    if post_process_value:
                        await self._run_post_process_scripts(
                            job_id, Path(output_dir), post_process_value
                        )

                    # Scan output directory for files and create output_files records
                    await self._register_output_files(job_id, Path(output_dir))
                    
                    # Get output files for broadcast
                    output_files_summary = []
                    async with aiosqlite.connect(self.db_path) as db:
                        await db.execute("PRAGMA foreign_keys = ON")
                        db.row_factory = aiosqlite.Row
                        cursor = await db.execute(
                            """
                            SELECT filename, size_bytes
                            FROM output_files
                            WHERE job_id = ?
                            """,
                            (job_id,),
                        )
                        rows = await cursor.fetchall()
                        for row in rows:
                            output_files_summary.append({
                                "filename": row["filename"],
                                "size_bytes": row["size_bytes"],
                                "download_url": f"/api/jobs/{job_id}/outputs/{row['filename']}",
                            })
                    
                    # Broadcast completed event
                    await self._broadcast_completed_event(job_id, output_files_summary)
                else:
                    status = "failed"
                    # Extract error message from CLI output (last few lines)
                    error_lines = output_lines[-10:] if output_lines else []
                    error_message = "".join(error_lines).strip() or f"CLI exited with code {exit_code}"
                    
                    # Broadcast failed event
                    await self._broadcast_failed_event(job_id, exit_code, error_message)
                
                # Update database with final status
                async with aiosqlite.connect(self.db_path) as db:
                    await db.execute("PRAGMA foreign_keys = ON")
                    await db.execute(
                        """
                        UPDATE jobs
                        SET status = ?,
                            completed_at = ?,
                            exit_code = ?,
                            error_message = ?
                        WHERE job_id = ?
                        """,
                        (status, end_time, exit_code, error_message, job_id),
                    )
                    await db.commit()
                
                logger.info(f"Job {job_id} finalized with status '{status}'")
            
            except asyncio.CancelledError:
                # Job was cancelled
                logger.info(f"Job {job_id} execution cancelled")
                async with aiosqlite.connect(self.db_path) as db:
                    await db.execute("PRAGMA foreign_keys = ON")
                    await db.execute(
                        """
                        UPDATE jobs
                        SET status = 'failed',
                            completed_at = ?,
                            error_message = 'Job cancelled'
                        WHERE job_id = ?
                        """,
                        (datetime.utcnow().isoformat(), job_id),
                    )
                    await db.commit()
                raise
            
            except Exception as e:
                # Unexpected error during execution
                logger.error(f"Error executing job {job_id}: {e}", exc_info=True)
                async with aiosqlite.connect(self.db_path) as db:
                    await db.execute("PRAGMA foreign_keys = ON")
                    await db.execute(
                        """
                        UPDATE jobs
                        SET status = 'failed',
                            completed_at = ?,
                            error_message = ?
                        WHERE job_id = ?
                        """,
                        (
                            datetime.utcnow().isoformat(),
                            f"Internal error: {str(e)}",
                            job_id,
                        ),
                    )
                    await db.commit()
    
    async def _run_post_process_scripts(
        self, job_id: str, output_dir: Path, post_process_value: str
    ) -> None:
        """
        Run every configured post-processing script (see
        _parse_post_process_scripts) against every `.gcode` file this job
        produced, in order, matching native's own "run every configured
        script, in order, against the same file" semantics
        (PostProcessor.cpp's run_post_process_scripts loop). Scripts are
        expected to modify the gcode file IN PLACE (exactly like
        scripts/addMD5.sh does) — this app does not implement native's
        optional "script renames the output file" mechanism
        (path_output_name / SLIC3R_PP_OUTPUT_NAME in PostProcessor.cpp),
        since nothing in this app's own job pipeline currently needs it.

        A script that exits non-zero, or is missing/non-executable, logs a
        warning and is skipped rather than failing the whole (already
        exit-code-0-completed) job — the slice itself succeeded; a broken
        post-processing script shouldn't retroactively turn a completed
        job into a failed one, it should just leave the gcode
        un-post-processed. This mirrors _register_output_files/
        _splice_thumbnail_into_gcode's own philosophy of "best-effort,
        log and continue" for CLI-gap workarounds.
        """
        scripts = _parse_post_process_scripts(post_process_value)
        if not scripts:
            return

        gcode_paths = sorted(output_dir.glob("*.gcode"))
        if not gcode_paths:
            logger.warning(
                f"Job {job_id}: post_process configured but no .gcode files found in {output_dir}"
            )
            return

        for gcode_path in gcode_paths:
            for script in scripts:
                try:
                    exit_code, output = await _run_post_process_script(script, gcode_path)
                except Exception as e:
                    logger.error(
                        f"Job {job_id}: failed to launch post-processing script "
                        f"'{script}' on {gcode_path.name}: {e}"
                    )
                    continue

                if exit_code != 0:
                    logger.warning(
                        f"Job {job_id}: post-processing script '{script}' on "
                        f"{gcode_path.name} exited with code {exit_code}. Output: {output.strip()}"
                    )
                else:
                    logger.info(
                        f"Job {job_id}: post-processing script '{script}' ran "
                        f"successfully on {gcode_path.name}"
                    )

    async def _apply_filename_format(self, job_id: str, cli_args: list[str], output_dir: Path) -> None:
        """
        Rename every `.gcode` this job produced according to
        `filename_format` (a `--filename-format=...` value in cli_args if
        the user overrode it, else PrintConfig.cpp's own documented
        default — see DEFAULT_FILENAME_FORMAT), matching what native
        OrcaSlicer's `PrintBase::output_filename` would have named the
        file.

        This exists because the CLI never actually calls
        `output_filename` for `--slice`'s plate exports (`OrcaSlicer.cpp`
        hardcodes `outfile_dir + "/plate_" + N + ".gcode"` — see
        that file's --slice handler) — `filename_format`'s configured
        value is accepted and merely echoed into the gcode's own
        CONFIG_BLOCK footer dump, never applied to the actual output
        path. Same category of CLI-only gap as post_process/thumbnails
        elsewhere in this module/routers/jobs.py.

        The three placeholders this substitutes are resolved from
        values the CLI itself already wrote into each gcode file's own
        footer (input file's basename, filament_type, and the
        "estimated printing time (normal mode)" line) — reading them
        back out of the gcode is simpler and more accurate than trying
        to recompute filament_type/print_time independently in Python,
        and guarantees the values exactly match what native itself
        would have used for that same file's placeholders.
        """
        filename_format = _extract_cli_flag_value(cli_args, "filename-format") or DEFAULT_FILENAME_FORMAT
        if "{" not in filename_format:
            # No placeholders at all — nothing to substitute, and
            # (matching native) every plate would collide on the same
            # literal name, so skip renaming entirely rather than
            # silently overwriting one plate's output with another's.
            return

        input_paths = _extract_input_file_paths(cli_args)
        input_filename_base = Path(input_paths[0]).stem if input_paths else "output"

        for gcode_path in sorted(output_dir.glob("*.gcode")):
            try:
                gcode_text = gcode_path.read_text(encoding="utf-8", errors="replace")
            except OSError as e:
                logger.warning(f"Job {job_id}: could not read {gcode_path.name} for filename_format: {e}")
                continue

            filament_type = _extract_gcode_config_value(gcode_text, "filament_type") or ""
            print_time_dhms = _extract_gcode_config_value(
                gcode_text, "estimated printing time (normal mode)"
            ) or ""
            print_time = _short_time(print_time_dhms) if print_time_dhms else ""

            new_name = _substitute_filename_format(
                filename_format, input_filename_base, filament_type, print_time
            )
            # Sanitize: strip any path separators a malformed/malicious
            # filename_format override could smuggle in — the result
            # must stay a bare filename inside output_dir, never escape
            # it (mirrors resolve_and_guard's intent elsewhere in this
            # codebase, applied here since Path(new_name) below doesn't
            # itself validate containment).
            new_name = new_name.replace("/", "_").replace("\\", "_")
            if not new_name:
                continue

            new_path = output_dir / new_name
            if new_path == gcode_path:
                continue
            if new_path.exists():
                # Two plates resolved to the same name (e.g. filament_type
                # placeholder absent from a malformed override) — don't
                # clobber an already-renamed sibling output.
                logger.warning(
                    f"Job {job_id}: filename_format collision, keeping "
                    f"{gcode_path.name} (target {new_name} already exists)"
                )
                continue

            try:
                gcode_path.rename(new_path)
                logger.info(f"Job {job_id}: renamed {gcode_path.name} -> {new_name} per filename_format")
            except OSError as e:
                logger.warning(f"Job {job_id}: failed to rename {gcode_path.name} to {new_name}: {e}")

    async def _register_output_files(self, job_id: str, output_dir: Path) -> None:
        """
        Scan output directory and create output_files database records.
        
        Args:
            job_id: The job that produced the files
            output_dir: Directory containing output files
        """
        if not output_dir.exists():
            logger.warning(f"Output directory {output_dir} does not exist for job {job_id}")
            return
        
        output_files = []
        for file_path in output_dir.iterdir():
            if file_path.is_file():
                output_files.append({
                    "output_file_id": str(uuid.uuid4()),
                    "job_id": job_id,
                    "filename": file_path.name,
                    "size_bytes": file_path.stat().st_size,
                    "storage_path": str(file_path),
                    "created_at": datetime.utcnow().isoformat(),
                })
        
        if output_files:
            async with aiosqlite.connect(self.db_path) as db:
                await db.execute("PRAGMA foreign_keys = ON")
                await db.executemany(
                    """
                    INSERT INTO output_files
                    (output_file_id, job_id, filename, size_bytes, storage_path, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            f["output_file_id"],
                            f["job_id"],
                            f["filename"],
                            f["size_bytes"],
                            f["storage_path"],
                            f["created_at"],
                        )
                        for f in output_files
                    ],
                )
                await db.commit()
            
            logger.info(f"Registered {len(output_files)} output files for job {job_id}")
