"""
Database connection and migration management for OrcaSlicer Web UI.

Provides aiosqlite connection factory and migration runner.
Requirements: 9.1
"""

import aiosqlite
from pathlib import Path
from typing import AsyncIterator

from app.config import settings


def get_db_path() -> Path:
    """
    Get the path to the database file.
    
    Returns:
        Path to the SQLite database file
    """
    workspace_path = Path(settings.workspace_root)
    return workspace_path / "orcaslicer_webui.db"


async def init_db() -> None:
    """
    Initialize the database and run migrations.
    
    Creates the database file if it doesn't exist and applies all migration scripts
    from the migrations/ directory in order.
    """
    # Ensure workspace root exists
    workspace_path = Path(settings.workspace_root)
    workspace_path.mkdir(parents=True, exist_ok=True)
    
    db_path = get_db_path()
    
    # Connect to database (creates file if doesn't exist)
    async with aiosqlite.connect(db_path) as db:
        # Enable foreign key constraints
        await db.execute("PRAGMA foreign_keys = ON")
        
        # Run migrations
        await _run_migrations(db)
        
        await db.commit()


async def _run_migrations(db: aiosqlite.Connection) -> None:
    """
    Apply all migration scripts to the database.
    
    Migrations are located in the migrations/ directory and are applied in
    alphabetical order. Each migration is tracked to prevent re-application.
    """
    # Create migrations tracking table if it doesn't exist
    await db.execute("""
        CREATE TABLE IF NOT EXISTS _migrations (
            migration_name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    
    # Get list of already applied migrations
    cursor = await db.execute("SELECT migration_name FROM _migrations")
    applied = {row[0] for row in await cursor.fetchall()}
    
    # Find migration files
    migrations_dir = Path(__file__).parent.parent / "migrations"
    if not migrations_dir.exists():
        print(f"Warning: migrations directory not found at {migrations_dir}")
        return
    
    migration_files = sorted(migrations_dir.glob("*.sql"))
    
    # Apply each migration
    for migration_file in migration_files:
        migration_name = migration_file.name
        
        if migration_name in applied:
            print(f"  ✓ Migration {migration_name} already applied")
            continue
        
        print(f"  → Applying migration {migration_name}")
        
        # Read and execute migration SQL
        migration_sql = migration_file.read_text()
        await db.executescript(migration_sql)
        
        # Record migration as applied
        await db.execute(
            "INSERT INTO _migrations (migration_name) VALUES (?)",
            (migration_name,)
        )
        
        print(f"  ✓ Migration {migration_name} applied successfully")


async def get_db() -> AsyncIterator[aiosqlite.Connection]:
    """
    Dependency that provides a database connection.
    
    Usage:
        @app.get("/endpoint")
        async def endpoint(db: aiosqlite.Connection = Depends(get_db)):
            cursor = await db.execute("SELECT ...")
            ...
    """
    db_path = get_db_path()
    
    async with aiosqlite.connect(db_path) as db:
        # Enable foreign key constraints for this connection
        await db.execute("PRAGMA foreign_keys = ON")
        # Enable row factory for dict-like access
        db.row_factory = aiosqlite.Row
        yield db
