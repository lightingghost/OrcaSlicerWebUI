"""
Pytest fixtures for OrcaSlicer Web UI backend tests.

Provides common fixtures for database, workspace, and configuration.
"""

import tempfile
from pathlib import Path

import aiosqlite
import pytest


@pytest.fixture
async def temp_workspace():
    """Create a temporary workspace for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        workspace = Path(tmpdir)
        
        # Create required subdirectories
        (workspace / "sessions").mkdir()
        (workspace / "jobs").mkdir()
        (workspace / "custom_profiles").mkdir()
        
        yield workspace


@pytest.fixture
async def test_db(temp_workspace):
    """
    Create a test database with schema and return a context manager factory.
    
    Usage in tests:
        async with test_db() as db:
            await db.execute(...)
    """
    db_path = temp_workspace / "test.db"
    
    # Create schema
    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys = ON")
        
        # Create jobs table
        await db.execute("""
            CREATE TABLE jobs (
                job_id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                submitted_at TEXT NOT NULL,
                started_at TEXT,
                completed_at TEXT,
                status TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','completed','failed','timed_out')),
                action_type TEXT NOT NULL,
                cli_args TEXT NOT NULL,
                exit_code INTEGER,
                error_message TEXT,
                output_dir TEXT NOT NULL
            )
        """)
        
        # Create output_files table
        await db.execute("""
            CREATE TABLE output_files (
                output_file_id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
                filename TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                storage_path TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        
        # Create files table (needed for some tests)
        await db.execute("""
            CREATE TABLE files (
                file_id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                original_name TEXT NOT NULL,
                extension TEXT NOT NULL CHECK (extension IN ('stl','3mf','obj','amf','json')),
                size_bytes INTEGER NOT NULL,
                storage_path TEXT NOT NULL,
                uploaded_at TEXT NOT NULL
            )
        """)
        
        await db.commit()
    
    # Return a factory function that creates connections
    class DBContextFactory:
        def __init__(self, path):
            self.path = path
        
        async def __aenter__(self):
            self.conn = await aiosqlite.connect(self.path)
            await self.conn.execute("PRAGMA foreign_keys = ON")
            self.conn.row_factory = aiosqlite.Row
            return self.conn
        
        async def __aexit__(self, exc_type, exc, tb):
            if exc_type is None:
                await self.conn.commit()
            await self.conn.close()
    
    return DBContextFactory(db_path)
