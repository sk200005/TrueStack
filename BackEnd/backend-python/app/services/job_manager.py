"""
services/job_manager.py — In-memory job state and background task runner.

Tracks job lifecycle (pending → running → done/error) and stores SSE events
so the streaming endpoint can replay + continue for late-connecting clients.

This is intentionally simple — jobs live in a dict in this process's memory.
LangGraph's own checkpointing handles graph-level resume; this module just
tracks the top-level job status for the HTTP API layer.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)


class JobState:
    """Mutable state for a single job."""

    def __init__(self, job_id: str, user_id: str, query_text: str, sources: list[str]):
        self.job_id = job_id
        self.user_id = user_id
        self.query_text = query_text
        self.sources = sources
        self.status: str = "pending"  # pending | running | done | error
        self.sources_failed: list[str] = []
        self.results: Optional[dict[str, Any]] = None
        self.events: list[dict[str, Any]] = []
        self.event_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    def emit_event(self, event: dict[str, Any]) -> None:
        """Store an event and push it to any waiting SSE consumers."""
        event.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
        event.setdefault("jobId", self.job_id)
        self.events.append(event)
        self.event_queue.put_nowait(event)


# ── Global job registry ───────────────────────────────────────────────────

_jobs: dict[str, JobState] = {}


def create_job(job_id: str, user_id: str, query_text: str, sources: list[str]) -> JobState:
    """Register a new job. Raises ValueError if the job_id already exists."""
    if job_id in _jobs:
        raise ValueError(f"Job {job_id} already exists")
    job = JobState(job_id, user_id, query_text, sources)
    _jobs[job_id] = job
    logger.info("Job %s created (query=%r, sources=%s)", job_id, query_text, sources)
    return job


def get_job(job_id: str) -> Optional[JobState]:
    """Lookup a job by ID. Returns None if not found."""
    return _jobs.get(job_id)
