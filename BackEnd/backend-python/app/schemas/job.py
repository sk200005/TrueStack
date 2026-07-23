"""
schemas/job.py — Pydantic models for the /api/v1/jobs contract.

These map 1:1 to the shapes defined in docs/python-service-contract.md.
The Node client (pythonServiceClient.js) is already built against these
exact field names and types — do NOT rename without updating the contract.
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


# ── Request ───────────────────────────────────────────────────────────────

class JobSubmitRequest(BaseModel):
    """POST /api/v1/jobs — request body from Node gateway."""

    jobId: str = Field(..., description="UUID v4 assigned by Node")
    userId: str = Field(..., description="UUID of the authenticated user")
    queryText: str = Field(..., description="Natural-language research query")
    sources: Optional[list[str]] = Field(
        default=None,
        description="Sources to scrape. Defaults to all if omitted.",
    )


# ── Responses ─────────────────────────────────────────────────────────────

class JobAcceptedResponse(BaseModel):
    """202 Accepted — returned immediately after job submission."""

    jobId: str
    status: str = "pending"
    message: str = "Job accepted"


class JobStatusResponse(BaseModel):
    """200 OK — returned by GET /api/v1/jobs/{jobId}/status."""

    jobId: str
    status: str  # pending | running | done | error
    sources_failed: Optional[list[str]] = None
    results: Optional[dict[str, Any]] = None


class JobResultResponse(BaseModel):
    """200 OK — returned by GET /api/v1/jobs/{jobId}/result."""

    jobId: str
    report: dict[str, Any]


# ── SSE Event ─────────────────────────────────────────────────────────────

class SSEEvent(BaseModel):
    """
    Shape of every SSE data chunk sent over GET /api/v1/jobs/{jobId}/stream.

    The Node parser (pythonServiceClient.js L70-87) expects:
      data: <this JSON>\\n\\n

    Terminal events: type="done" or type="error" cause Node to close the stream.
    """

    type: str           # "connected" | "progress" | "done" | "error"
    jobId: str
    source: Optional[str] = None      # "wikipedia" | "reddit" | etc.
    status: Optional[str] = None      # "started" | "done" | "error"
    counts: Optional[dict[str, Any]] = None
    error: Optional[str] = None
    timestamp: Optional[str] = None
