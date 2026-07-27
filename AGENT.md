# AGENT.md — OrcaSlicerWebUI

Guidance for AI agents (and humans) working in this directory. This file
covers project goal, architecture, directory layout, conventions, and
common pitfalls specific to `OrcaSlicerWebUI/`. For OrcaSlicer's own native
source, see `../OrcaSlicer/AGENTS.md`.

## Project Goal

Build a browser-based front-end for the OrcaSlicer CLI (`orca-slicer`) that
replicates the functionality — and, where feasible, the exact option
layout — of the native OrcaSlicer desktop app. Users upload 3D models
(STL/3MF/OBJ/AMF), pick printer/process/filament profiles, tune slicing
parameters, submit slicing/export jobs, watch real-time progress, and
download the resulting G-code/3MF — entirely from a browser, without
installing OrcaSlicer locally.

The backend is a thin, security-conscious wrapper around the `orca-slicer`
CLI binary: it never reimplements slicing logic, it only prepares inputs,
invokes the CLI as a subprocess, and streams results back.

Full requirements/design/task breakdown live in
`../.kiro/specs/orca-slicer-web-ui/` (`requirements.md`, `design.md`,
`tasks.md`). Read `requirements.md` before making behavioral changes — it
defines acceptance criteria (numbered "Requirement N") that PRs should
trace back to.

## Architecture

```
Browser ── nginx (prod, :80) / vite dev server (:5173)
              │
              ▼
        FastAPI backend (:8000)
              │
              ├── spawns `orca-slicer` CLI as a subprocess (job_manager.py + cli_builder.py)
              ├── SQLite (job records, file metadata) — under TMP_ROOT, ephemeral
              ├── WebSocket per job (real-time progress from CLI's progress pipe)
              ├── WORKSPACE_ROOT (persistent): user configs, autosaves, custom profiles
              └── TMP_ROOT (ephemeral, tmpfs-able): uploads, job outputs, logs, db
```

- **Backend**: FastAPI (Python), wraps the OrcaSlicer CLI. See
  `backend/README.md`.
- **Frontend**: React 18 + TypeScript SPA, Three.js 3D viewport, Zustand
  for state. See `frontend/src/store/README.md`.
- **Deployment**: Docker Compose (nginx + FastAPI containers) or
  `run-local.sh` for local dev without Docker.

## Directory Layout

```
OrcaSlicerWebUI/
├── AGENT.md            # this file
├── README.md           # architecture/feature overview, quick start
├── SETUP.md            # detailed setup guide (AppImage extraction, .env, troubleshooting)
├── run-local.sh         # starts backend (uvicorn) + frontend (vite) without Docker
├── docker-compose.yml   # nginx + FastAPI containers for deployment
├── .env.example         # template for API_SECRET etc.
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, lifespan startup (auth/db/ws/job manager init)
│   │   ├── config.py            # Settings (env vars), profiles_root/workspace derivation
│   │   ├── auth.py               # Bearer token auth (verify_token dependency)
│   │   ├── database.py           # SQLite init/migrations
│   │   ├── job_manager.py        # job queue, subprocess execution, progress parsing
│   │   ├── cli_builder.py        # builds safe CLI argv list; resolve_and_guard() path safety
│   │   ├── parameter_parser.py   # parses OrcaSlicer's PrintConfig.cpp + Tab.cpp into parameters.json
│   │   ├── ws_manager.py         # WebSocket connection registry per job
│   │   ├── cleanup.py            # background task: expires old outputs/job records
│   │   ├── data/parameters.json  # generated snapshot consumed by routers/parameters.py
│   │   └── routers/
│   │       ├── files.py          # upload/download/delete of model files
│   │       ├── profiles.py       # browse profiles, resolve `inherits` chains, custom profile upload
│   │       ├── parameters.py     # GET /api/parameters (serves parameters.json), PARAM_ALLOWLIST
│   │       ├── jobs.py           # submit/list/cancel jobs, output file listing/download
│   │       ├── user_config.py    # persist last-used printer/process/filament selection
│   │       └── websockets.py     # per-job progress WebSocket endpoint
│   ├── migrations/                # SQLite schema migrations
│   ├── tests/                     # pytest suite (unit, integration, property-based via Hypothesis)
│   └── pyproject.toml
└── frontend/
    └── src/
        ├── api/client.ts           # typed REST client (ApiClient), auth header injection
        ├── store/                  # Zustand slices, composed in store/index.ts
        │   ├── fileSlice.ts        # uploaded file state
        │   ├── profileSlice.ts     # manufacturer/printer/process/filament selection, resolved profile defaults
        │   ├── parameterSlice.ts   # parameter descriptors, user overrides, profile-derived defaults, validation
        │   ├── jobSlice.ts         # job submission, WebSocket progress, REST-polling fallback
        │   ├── transformSlice.ts   # rotate/scale/arrange/orient options
        │   ├── viewportSlice.ts    # 3D viewport state (bounding box, model metadata)
        │   ├── miscSlice.ts        # advanced CLI misc options
        │   └── actionSlice.ts      # slice/export action + action flags
        ├── components/
        │   ├── LeftPanel/          # PrinterSelector, ProcessSelector, FilamentRow, ParameterTabs/Panel/Field
        │   ├── Layout/             # app shell, top bar, left/right panel containers
        │   ├── JobPanel/           # submit button, job status/history UI
        │   ├── Progress/           # progress bar, warning banner, output file list
        │   ├── ThreeViewport.tsx  # Three.js build-plate + model rendering
        │   ├── ViewPresetToolbar.tsx
        │   └── ObjectInfoOverlay.tsx
        ├── lib/                    # validation.ts, progressSocket.ts, modelLoader.ts
        └── pages/
```

## Key Concepts

### Parameter descriptors and the native UI layout

`backend/app/parameter_parser.py` parses **two** OrcaSlicer C++ source
files (from `../OrcaSlicer/src/`) to build `data/parameters.json`:

1. `libslic3r/PrintConfig.cpp` — the source of truth for every parameter's
   key, label, tooltip, type, default value, min/max, enum values, and
   unit (`sidetext`).
2. `slic3r/GUI/Tab.cpp`'s `TabPrint::build()` — the source of truth for how
   the **native desktop app** organizes Process-tab parameters into pages
   (Quality/Strength/Speed/Support/Multimaterial/Others), option groups
   within each page (e.g. "Layer height", "Line width", "Seam"), and the
   exact display order.

Every parameter matched to `TabPrint::build()` is tagged with `section`,
`group`, `group_order`, and `order` so the web UI's `ParameterPanel` can
reproduce the native layout exactly — same options, same groupings, same
order, label-left/value-right rows. Parameters that only exist on
printer/filament tabs (not Process) have `group: null` and are excluded
from the Process tab view.

**Re-run the parser whenever OrcaSlicer's source changes:**
```bash
cd backend && python -m app.parameter_parser
```

### Process profile resolution (`inherits` chains)

OrcaSlicer profile JSON files (`resources/profiles/<Vendor>/process/*.json`)
only store the handful of keys that differ from their parent profile. The
full effective configuration requires walking the `inherits` chain, with
each parent looked up by `name` in the vendor's index file (e.g.
`resources/profiles/Flashforge.json`'s `process_list`/`machine_list`/
`filament_list`).

`backend/app/routers/profiles.py::resolve_profile_config()` implements this
resolution (base-to-specific merge, cycle-guarded), exposed via
`GET /api/profiles/{manufacturer}/{category}/{filename}/resolved`.

The frontend calls this endpoint from `profileSlice.selectProcessProfile()`
and stores the result in `parameterSlice.profileDefaults` (NOT
`overrides` — profile-loaded values are the field's *default*, not a user
override). `parameterSlice.getEffectiveDefault(descriptor)` returns the
profile-loaded value if present, else the global `default_value` from
`parameters.json`. Never populate `overrides` directly from a loaded
profile — that would incorrectly show the Reset button / purple
"overridden" styling for values the user never touched.

### Security model (see Requirement 11)

- CLI arguments are always passed as a Python list to
  `asyncio.create_subprocess_exec` (`cli_builder.py`) — never via shell
  string interpolation.
- All file paths (uploads, profiles, outputs) are resolved and checked with
  `cli_builder.resolve_and_guard()` to stay within their designated root
  (workspace root or profiles root). Never bypass this for new path-taking
  endpoints.
- Parameter override keys are validated against `PARAM_ALLOWLIST`
  (`routers/parameters.py`, built from `parameters.json`) before being
  passed to the CLI.
- All API routes (except `/health`) require `Authorization: Bearer <token>`
  via `app/auth.py`'s `verify_token` dependency, checked against
  `API_SECRET`.

### Validation nuance: `null` vs `undefined` bounds

Backend `min`/`max` are `Optional[float] = None`, which serialize as JSON
`null`, not JS `undefined`. Frontend code must use `!= null` (loose) checks
rather than `!== undefined` when treating an absent bound as "no limit" —
see `frontend/src/lib/validation.ts`. A strict `undefined` check lets
`null` through and then incorrectly compares `value > null`.

## Configuration

Backend settings (`backend/app/config.py`, env-var driven, see
`.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `ORCA_CLI_PATH` | `/app/orca-slicer/build/linux/OrcaSlicer_ubu64` | path to `orca-slicer` binary |
| `WORKSPACE_ROOT` | `/app/workspace` | persistent: user configs/autosaves/custom profiles |
| `TMP_ROOT` | `/app/tmp` | ephemeral: uploads/job outputs/logs/db (tmpfs-able) |
| `MAX_CONCURRENT_JOBS` | 4 | job queue concurrency |
| `JOB_TIMEOUT_SECONDS` | 3600 | kill CLI subprocess after this long |
| `OUTPUT_RETENTION_SECONDS` | 86400 | output file cleanup age |
| `JOB_RECORD_RETENTION_SECONDS` | 604800 | job history cleanup age |
| `API_SECRET` | `changeme` | Bearer token secret — **must** be overridden outside local dev |

`settings.profiles_root` is derived from `ORCA_CLI_PATH` (assumes the
standard OrcaSlicer build/AppImage-extraction layout:
`.../resources/profiles` two levels up from the CLI's build dir).

## Running Locally

```bash
# Without Docker (fastest for iteration):
./run-local.sh        # starts backend :8000 + frontend :5173

# With Docker (closer to production):
docker-compose up --build   # http://localhost
```

See `SETUP.md` for AppImage extraction and troubleshooting (401 auth
errors, CLI-not-found, port conflicts).

## Testing

```bash
# Backend (pytest, includes Hypothesis property-based tests)
cd backend && pytest -v
pytest -v -m property        # property tests only

# Frontend (vitest, includes fast-check property-based tests)
cd frontend && npm test
npm run test:property        # property tests only
```

**Known pre-existing flaky areas (not introduced by typical parameter/UI
work, safe to ignore unless you touch them directly):**
- `backend/tests/test_database.py` fails to import (`Database` vs `database`
  naming mismatch).
- Several backend profile tests (`test_task_4_2.py`, `test_task_4_3.py`,
  `test_task_4_5.py`, etc.) fail only when run as part of the *full* suite
  due to a shared `app.auth`/`app.config` singleton being initialized by
  whichever test file imports it first with different env vars. They pass
  when run in isolation. If adding new tests that call `app.main`/`app.auth`
  directly (bypassing a `client` fixture), set env vars at **module import
  time** (`os.environ.setdefault(...)`), not inside a fixture — see
  `backend/tests/test_profile_resolution.py` for the pattern.
- `frontend/src/components/LeftPanel/{FilamentRow,PrinterSelector,
  ProcessSelector}.test.tsx` and `src/App.test.tsx` have some pre-existing
  failures unrelated to parameter/profile work (stale mocks / missing
  `saveUserConfig` mock).

Always verify whether a failure is pre-existing (run the single test file
in isolation) before treating it as a regression from your change.

## Conventions

- **Backend**: FastAPI + Pydantic v2 models per router. New endpoints must
  go through the `verify_token` auth dependency and, if they touch the
  filesystem, through `resolve_and_guard`.
- **Frontend**: Zustand slices compose into one store (`store/index.ts`).
  Each slice is a `StateCreator`; cross-slice access uses the 4-type-arg
  `StateCreator<FullStoreType, [], [], ThisSliceType>` form when a slice
  needs to call another slice's actions (see `profileSlice.ts` depending on
  `ParameterSlice`).
- Components pair 1:1 with a `.test.tsx` and often a `.README.md`
  documenting behavior/props (see `LeftPanel/*.README.md`,
  `ParameterTabs.README.md`).
- Match the native OrcaSlicer desktop UI's option labels, grouping, and
  ordering whenever adding/changing parameter UI — derive it from
  `Tab.cpp`/`PrintConfig.cpp` rather than inventing new groupings.
- Prefer editing `parameter_parser.py`'s parsing logic over hand-editing
  `data/parameters.json` — the file is a generated snapshot and will be
  overwritten on next run.
