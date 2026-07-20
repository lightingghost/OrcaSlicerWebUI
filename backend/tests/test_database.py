"""Tests for database connection and migration functionality."""

import tempfile
from pathlib import Path

import pytest

from app.database import Database, init_database, get_database, get_db


class TestDatabase:
    """Test database connection and migration functionality."""

    @pytest.fixture
    async def temp_db(self, tmp_path: Path):
        """Create a temporary database for testing."""
        db_path = tmp_path / "test.db"
        migrations_dir = Path(__file__).parent.parent / "migrations"
        db = Database(db_path, migrations_dir)
        await db.run_migrations()
        return db

    async def test_database_connection(self, temp_db: Database):
        """Test that database connection can be established."""
        conn = await temp_db.connect()
        assert conn is not None
        await conn.close()

    async def test_migrations_create_tables(self, temp_db: Database):
        """Test that migrations create all required tables with correct schema."""
        conn = await temp_db.connect()
        try:
            # Check that files table exists with correct columns
            cursor = await conn.execute("PRAGMA table_info(files)")
            files_columns = {row[1] for row in await cursor.fetchall()}
            assert "file_id" in files_columns
            assert "session_id" in files_columns
            assert "original_name" in files_columns
            assert "extension" in files_columns
            assert "size_bytes" in files_columns
            assert "storage_path" in files_columns
            assert "uploaded_at" in files_columns

            # Check that jobs table exists with correct columns
            cursor = await conn.execute("PRAGMA table_info(jobs)")
            jobs_columns = {row[1] for row in await cursor.fetchall()}
            assert "job_id" in jobs_columns
            assert "session_id" in jobs_columns
            assert "submitted_at" in jobs_columns
            assert "started_at" in jobs_columns
            assert "completed_at" in jobs_columns
            assert "status" in jobs_columns
            assert "action_type" in jobs_columns
            assert "cli_args" in jobs_columns
            assert "exit_code" in jobs_columns
            assert "error_message" in jobs_columns
            assert "output_dir" in jobs_columns

            # Check that output_files table exists with correct columns
            cursor = await conn.execute("PRAGMA table_info(output_files)")
            output_files_columns = {row[1] for row in await cursor.fetchall()}
            assert "output_file_id" in output_files_columns
            assert "job_id" in output_files_columns
            assert "filename" in output_files_columns
            assert "size_bytes" in output_files_columns
            assert "storage_path" in output_files_columns
            assert "created_at" in output_files_columns
        finally:
            await conn.close()

    async def test_migrations_create_indexes(self, temp_db: Database):
        """Test that migrations create all required indexes."""
        conn = await temp_db.connect()
        try:
            # Get all indexes
            cursor = await conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
            )
            indexes = {row[0] for row in await cursor.fetchall()}

            # Check that required indexes exist
            assert "idx_files_session" in indexes
            assert "idx_jobs_session_submitted" in indexes
            assert "idx_jobs_status" in indexes
            assert "idx_output_files_job" in indexes
        finally:
            await conn.close()

    async def test_foreign_key_constraints_enabled(self, temp_db: Database):
        """Test that foreign key constraints are enabled."""
        conn = await temp_db.connect()
        try:
            cursor = await conn.execute("PRAGMA foreign_keys")
            result = await cursor.fetchone()
            assert result[0] == 1, "Foreign key constraints should be enabled"
        finally:
            await conn.close()

    async def test_extension_check_constraint(self, temp_db: Database):
        """Test that the extension CHECK constraint is enforced."""
        conn = await temp_db.connect()
        try:
            # Valid extension should succeed
            await conn.execute(
                """
                INSERT INTO files 
                (file_id, session_id, original_name, extension, size_bytes, storage_path, uploaded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                ("test-id", "session-1", "model.stl", "stl", 1024, "/path/to/file", "2024-01-01T00:00:00Z")
            )
            await conn.commit()

            # Invalid extension should fail
            with pytest.raises(Exception):  # aiosqlite.IntegrityError
                await conn.execute(
                    """
                    INSERT INTO files 
                    (file_id, session_id, original_name, extension, size_bytes, storage_path, uploaded_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    ("test-id-2", "session-1", "model.txt", "txt", 1024, "/path/to/file", "2024-01-01T00:00:00Z")
                )
                await conn.commit()
        finally:
            await conn.close()

    async def test_status_check_constraint(self, temp_db: Database):
        """Test that the job status CHECK constraint is enforced."""
        conn = await temp_db.connect()
        try:
            # Valid status should succeed
            await conn.execute(
                """
                INSERT INTO jobs
                (job_id, session_id, submitted_at, status, action_type, cli_args, output_dir)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                ("job-1", "session-1", "2024-01-01T00:00:00Z", "queued", "slice", "[]", "/output")
            )
            await conn.commit()

            # Invalid status should fail
            with pytest.raises(Exception):  # aiosqlite.IntegrityError
                await conn.execute(
                    """
                    INSERT INTO jobs
                    (job_id, session_id, submitted_at, status, action_type, cli_args, output_dir)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    ("job-2", "session-1", "2024-01-01T00:00:00Z", "invalid_status", "slice", "[]", "/output")
                )
                await conn.commit()
        finally:
            await conn.close()

    async def test_cascade_delete_output_files(self, temp_db: Database):
        """Test that deleting a job cascades to output_files."""
        conn = await temp_db.connect()
        try:
            # Insert a job
            await conn.execute(
                """
                INSERT INTO jobs
                (job_id, session_id, submitted_at, status, action_type, cli_args, output_dir)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                ("job-1", "session-1", "2024-01-01T00:00:00Z", "completed", "slice", "[]", "/output")
            )

            # Insert an output file
            await conn.execute(
                """
                INSERT INTO output_files
                (output_file_id, job_id, filename, size_bytes, storage_path, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                ("output-1", "job-1", "plate_1.gcode", 2048, "/output/plate_1.gcode", "2024-01-01T00:00:00Z")
            )
            await conn.commit()

            # Verify output file exists
            cursor = await conn.execute("SELECT COUNT(*) FROM output_files WHERE job_id = ?", ("job-1",))
            count = await cursor.fetchone()
            assert count[0] == 1

            # Delete the job
            await conn.execute("DELETE FROM jobs WHERE job_id = ?", ("job-1",))
            await conn.commit()

            # Verify output file was deleted (CASCADE)
            cursor = await conn.execute("SELECT COUNT(*) FROM output_files WHERE job_id = ?", ("job-1",))
            count = await cursor.fetchone()
            assert count[0] == 0
        finally:
            await conn.close()

    async def test_init_database_singleton(self, tmp_path: Path):
        """Test that init_database creates a global singleton."""
        db_path = tmp_path / "test.db"
        migrations_dir = Path(__file__).parent.parent / "migrations"

        db1 = init_database(db_path, migrations_dir)
        db2 = get_database()

        assert db1 is db2, "init_database should create a singleton instance"

    async def test_get_db_dependency(self, tmp_path: Path):
        """Test the FastAPI dependency function."""
        db_path = tmp_path / "test.db"
        migrations_dir = Path(__file__).parent.parent / "migrations"

        init_database(db_path, migrations_dir)
        await get_database().run_migrations()

        # Use the dependency
        async for conn in get_db():
            # Connection should be valid
            cursor = await conn.execute("SELECT 1")
            result = await cursor.fetchone()
            assert result[0] == 1

        # Connection should be closed after context exit
        # (we can't directly test this without additional introspection)
