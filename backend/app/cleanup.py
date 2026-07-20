"""
Background cleanup task for expired output files and job records.

Runs periodically to enforce retention policies defined in configuration.
Requirements: 8.4, 9.5
"""

import asyncio
import shutil
from datetime import datetime, timedelta
from pathlib import Path

import aiosqlite

from app.config import settings
from app.database import get_db_path


async def run_cleanup_loop() -> None:
    """
    Background task that periodically cleans up expired output files and job records.
    
    Runs every 10 minutes by default and performs two passes:
    1. Delete output files older than OUTPUT_RETENTION_SECONDS
    2. Delete job records older than JOB_RECORD_RETENTION_SECONDS
    """
    cleanup_interval_seconds = 600  # 10 minutes
    
    while True:
        try:
            await asyncio.sleep(cleanup_interval_seconds)
            await cleanup_expired_data()
        except asyncio.CancelledError:
            # Graceful shutdown requested
            break
        except Exception as e:
            # Log error but continue running
            print(f"Error in cleanup task: {e}")


async def cleanup_expired_data() -> None:
    """
    Execute both cleanup passes: output files, job records, and orphaned session directories.
    """
    try:
        await cleanup_output_files()
        await cleanup_job_records()
        await cleanup_orphaned_sessions()
    except Exception as e:
        print(f"Cleanup execution error: {e}")


async def cleanup_output_files() -> None:
    """
    Delete output files and directories for jobs completed longer ago than OUTPUT_RETENTION_SECONDS.
    
    Pass 1 of retention cleanup.
    Requirements: 8.4
    """
    cutoff = datetime.utcnow() - timedelta(seconds=settings.output_retention_seconds)
    cutoff_iso = cutoff.isoformat()
    
    db_path = get_db_path()
    async with aiosqlite.connect(db_path) as db:
        # Find completed jobs older than retention period
        cursor = await db.execute(
            """
            SELECT job_id, output_dir 
            FROM jobs 
            WHERE status = 'completed' 
              AND completed_at < ?
              AND completed_at IS NOT NULL
            """,
            (cutoff_iso,)
        )
        
        expired_jobs = await cursor.fetchall()
        
        for job_id, output_dir in expired_jobs:
            # Delete output directory and all its contents
            output_path = Path(output_dir)
            if output_path.exists():
                try:
                    shutil.rmtree(output_path, ignore_errors=True)
                    print(f"✓ Deleted expired output directory: {output_dir}")
                except Exception as e:
                    print(f"✗ Failed to delete output directory {output_dir}: {e}")
            
            # Delete output file records from database
            await db.execute(
                "DELETE FROM output_files WHERE job_id = ?",
                (job_id,)
            )
        
        await db.commit()
        
        if expired_jobs:
            print(f"✓ Cleaned up {len(expired_jobs)} expired output file set(s)")


async def cleanup_job_records() -> None:
    """
    Delete job records older than JOB_RECORD_RETENTION_SECONDS.
    
    Pass 2 of retention cleanup. CASCADE deletes associated output_files records.
    Requirements: 9.5
    """
    cutoff = datetime.utcnow() - timedelta(seconds=settings.job_record_retention_seconds)
    cutoff_iso = cutoff.isoformat()
    
    db_path = get_db_path()
    async with aiosqlite.connect(db_path) as db:
        # Enable foreign key constraints for CASCADE delete to work
        await db.execute("PRAGMA foreign_keys = ON")
        
        # Delete old job records (CASCADE will delete output_files)
        cursor = await db.execute(
            "DELETE FROM jobs WHERE submitted_at < ? RETURNING job_id",
            (cutoff_iso,)
        )
        
        deleted_jobs = await cursor.fetchall()
        await db.commit()
        
        if deleted_jobs:
            print(f"✓ Cleaned up {len(deleted_jobs)} expired job record(s)")


async def cleanup_orphaned_sessions() -> None:
    """
    Delete orphaned session upload directories.
    
    A session directory is considered orphaned if all jobs for that session
    are older than the job record retention period (meaning they would have
    been deleted or will be deleted in the next cleanup cycle).
    
    Pass 3 of retention cleanup.
    Requirements: 8.4, 9.5
    """
    cutoff = datetime.utcnow() - timedelta(seconds=settings.job_record_retention_seconds)
    cutoff_iso = cutoff.isoformat()
    
    sessions_dir = settings.session_uploads_dir
    if not sessions_dir.exists():
        return
    
    db_path = get_db_path()
    async with aiosqlite.connect(db_path) as db:
        # Get all session directories
        session_dirs = [d for d in sessions_dir.iterdir() if d.is_dir()]
        
        for session_dir in session_dirs:
            session_id = session_dir.name
            
            # Check if this session has any jobs newer than the cutoff
            cursor = await db.execute(
                """
                SELECT COUNT(*) 
                FROM jobs 
                WHERE session_id = ? AND submitted_at >= ?
                """,
                (session_id, cutoff_iso)
            )
            
            count_row = await cursor.fetchone()
            recent_job_count = count_row[0] if count_row else 0
            
            # Also check if this session has any files referenced by recent jobs
            cursor = await db.execute(
                """
                SELECT COUNT(*) 
                FROM files 
                WHERE session_id = ? AND uploaded_at >= ?
                """,
                (session_id, cutoff_iso)
            )
            
            count_row = await cursor.fetchone()
            recent_file_count = count_row[0] if count_row else 0
            
            # If no recent jobs or files, this session is orphaned
            if recent_job_count == 0 and recent_file_count == 0:
                try:
                    shutil.rmtree(session_dir, ignore_errors=True)
                    print(f"✓ Deleted orphaned session directory: {session_dir}")
                    
                    # Clean up database records for this session
                    await db.execute("DELETE FROM files WHERE session_id = ?", (session_id,))
                    await db.execute("DELETE FROM jobs WHERE session_id = ?", (session_id,))
                    
                except Exception as e:
                    print(f"✗ Failed to delete orphaned session directory {session_dir}: {e}")
        
        await db.commit()
