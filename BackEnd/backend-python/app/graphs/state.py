"""
graphs/state.py — LangGraph state schema.

This TypedDict is the single object passed between every node in the
research pipeline graph. It mirrors the design in docs/BackEnd and DB.md §3.2
but is scoped to what's needed for the Wikipedia-first phase (Milestone 2).

Future phases (Reddit, YouTube, News) will extend this state with
additional fields as needed.
"""

from __future__ import annotations

from typing import Any, Literal, Optional, TypedDict


class SourceDoc(TypedDict):
    """A single fetched document, before chunking."""

    source: str                         # "wikipedia" | "reddit" | "youtube" | ...
    author: Optional[str]
    text: str
    url: str
    published_at: Optional[str]
    engagement_metrics: Optional[dict[str, Any]]


class ResearchState(TypedDict, total=False):
    """
    LangGraph state flowing through the research pipeline.

    All fields are optional (total=False) so nodes only need to set the
    fields they produce. LangGraph merges partial updates into the
    accumulated state automatically.
    """

    job_id: str
    query: str
    sources_to_fetch: list[str]
    raw_documents: list[SourceDoc]
    failed_sources: list[str]
    status: Literal["pending", "fetching", "storing", "done", "error"]
    results: dict[str, Any]
