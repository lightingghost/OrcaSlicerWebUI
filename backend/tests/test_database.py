"""Tests for database connection and migration functionality."""

import pytest
import aiosqlite
from pathlib import Path
from unittest.mock import patch


@pytest.fixture
async def temp_db_path(tmp_path: Path):
    """Run migrations against a temp workspace and return the db path."""
    db_path = tmp_path / "orcaslicer_webui.db"
    migrations_dir = Path(__file__).parent.parent / "migrations"

    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA foreign_keys = ON")

        # Apply all migration SQL files in order
        for migration_file in sorted(migrations_dir.glob("*.sql")):
            sql = migration_file.read_text()
            await db.executescript(sql)

        await db.commit()

    return db_path


class TestDatabase:
    """Test database schema and migration functionality."""

    async def test_migrations_create_files_table(self, temp_db_path: Path):
        """Migrations must create the files table with required columns."""
        async with aiosqlite.connect(temp_db_path) as db:
            cursor = await db.execute("PRAGMA table_info(files)")
            columns = {row[1] for row in await cursor.fetchall()}
            assert "file_id" in columns
            assert "session_id" in columns
            assert "original_name" in columns
            assert "extension" in columns
            assert "size_bytes" in columns
            assert "storage_path" in columns
            assert "uploaded_at" in columns

    async def test_migrations_create_jobs_table(self, temp_db_path: Path):
        """Migrations must create the jobs table with required columns."""
        async with aiosqlite.connect(temp_db_path) as db:
            cursor = await db.execute("PRAGMA table_info(jobs)")
            columns = {row[1] for row in await cursor.fetchall()}
            assert "job_id" in columns
            assert "session_id" in columns
            assert "submitted_at" in columns
            assert "status" in columns

    async def test_migrations_create_output_files_table(self, temp_db_path: Path):
        """Migrations must create the output_files table with required columns."""
        async with aiosqlite.connect(temp_db_path) as db:
            cursor = await db.execute("PRAGMA table_info(output_files)")
            columns = {row[1] for row in await cursor.fetchall()}
            assert "output_file_id" in columns
            assert "job_id" in columns
            assert "filename" in columns
            assert "storage_path" in columns

    async def test_init_db_creates_database(self, tmp_path: Path):
        """init_db() must create the database file and schema."""
        from app.database import init_db, get_db_path

        with patch("app.database.settings") as mock_settings:
            mock_settings.tmp_root = str(tmp_path)
            await init_db()

        with patch("app.database.settings") as mock_settings:
            mock_settings.tmp_root = str(tmp_path)
            db_path = get_db_path()

        assert db_path.exists()

    async def test_get_db_path_uses_tmp_root(self, tmp_path: Path):
        """get_db_path() must return a path inside tmp_root (ephemeral)."""
        from app.database import get_db_path

        with patch("app.database.settings") as mock_settings:
            mock_settings.tmp_root = str(tmp_path)
            db_path = get_db_path()

        assert str(tmp_path) in str(db_path)
        assert db_path.name.endswith(".db")
