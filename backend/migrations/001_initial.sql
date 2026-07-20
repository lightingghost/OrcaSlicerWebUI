-- Initial schema for OrcaSlicer Web UI database
-- Creates tables for files, jobs, and output_files with indexes

CREATE TABLE IF NOT EXISTS files (
    file_id       TEXT PRIMARY KEY,          -- UUID v4
    session_id    TEXT NOT NULL,
    original_name TEXT NOT NULL,
    extension     TEXT NOT NULL CHECK (extension IN ('stl','3mf','obj','amf','json')),
    size_bytes    INTEGER NOT NULL,
    storage_path  TEXT NOT NULL,             -- absolute path within workspace_root
    uploaded_at   TEXT NOT NULL              -- ISO-8601 UTC
);

CREATE INDEX IF NOT EXISTS idx_files_session ON files(session_id);

CREATE TABLE IF NOT EXISTS jobs (
    job_id          TEXT PRIMARY KEY,        -- UUID v4
    session_id      TEXT NOT NULL,
    submitted_at    TEXT NOT NULL,           -- ISO-8601 UTC
    started_at      TEXT,
    completed_at    TEXT,
    status          TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','running','completed','failed','timed_out')),
    action_type     TEXT NOT NULL,           -- slice|export_3mf|export_stl|export_stls|export_settings
    cli_args        TEXT NOT NULL,           -- JSON-encoded list[str]
    exit_code       INTEGER,
    error_message   TEXT,
    output_dir      TEXT NOT NULL            -- absolute path within workspace_root
);

CREATE INDEX IF NOT EXISTS idx_jobs_session_submitted ON jobs(session_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

CREATE TABLE IF NOT EXISTS output_files (
    output_file_id  TEXT PRIMARY KEY,        -- UUID v4
    job_id          TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    size_bytes      INTEGER NOT NULL,
    storage_path    TEXT NOT NULL,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_output_files_job ON output_files(job_id);
