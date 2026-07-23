"""
graphs/research_graph.py — Builds and runs the LangGraph research pipeline.

Graph structure (Milestone 2 — Wikipedia only):
    START → wikipedia_fetch → store_documents → END

Future milestones will add parallel fetch nodes for Reddit, YouTube, News
and downstream summarize/verify nodes.

SSE events are emitted at each node boundary so the Node gateway can
stream live progress to the frontend client. The event format matches
docs/python-service-contract.md exactly.
"""

from __future__ import annotations

import logging
from typing import Any

from langgraph.graph import END, START, StateGraph

from app.graphs.nodes.store_node import store_documents
from app.graphs.nodes.wikipedia_node import wikipedia_fetch
from app.graphs.state import ResearchState
from app.services.job_manager import JobState

logger = logging.getLogger(__name__)


def build_graph() -> Any:
    """Construct and compile the LangGraph StateGraph for the research pipeline."""
    graph = StateGraph(ResearchState)

    graph.add_node("wikipedia_fetch", wikipedia_fetch)
    graph.add_node("store_documents", store_documents)

    graph.add_edge(START, "wikipedia_fetch")
    graph.add_edge("wikipedia_fetch", "store_documents")
    graph.add_edge("store_documents", END)

    return graph.compile()


async def run_pipeline(job: JobState) -> None:
    """
    Execute the research graph for a job. Called as a BackgroundTask
    by the jobs router.

    Emits SSE events to the job's event queue as each phase executes.
    Event format matches what pythonServiceClient.js expects to parse:
        { type, jobId, source, status, counts, error, timestamp }
    """
    job.status = "running"
    job.emit_event({"type": "connected", "status": "connected"})

    try:
        compiled_graph = build_graph()

        initial_state: ResearchState = {
            "job_id": job.job_id,
            "query": job.query_text,
            "sources_to_fetch": job.sources,
            "raw_documents": [],
            "failed_sources": [],
            "status": "pending",
            "results": {},
        }

        # Emit: wikipedia fetch started
        job.emit_event({"type": "progress", "source": "wikipedia", "status": "started"})

        # Run the full graph
        final_state = await compiled_graph.ainvoke(initial_state)

        # Collect results from the final state
        results = final_state.get("results", {})
        docs_count = results.get("docsInserted", 0)
        chunks_count = results.get("chunksInserted", 0)
        failed = final_state.get("failed_sources", [])

        # Emit: wikipedia fetch completed
        job.emit_event({
            "type": "progress",
            "source": "wikipedia",
            "status": "done" if "wikipedia" not in failed else "error",
            "counts": {"docsInserted": docs_count, "chunksInserted": chunks_count},
        })

        # Update job state
        job.results = {
            "wikipedia": {
                "status": "done" if "wikipedia" not in failed else "error",
                "docsInserted": docs_count,
                "chunksInserted": chunks_count,
            }
        }
        job.sources_failed = failed
        job.status = "done"

        # Emit terminal event — Node destroys the stream on receiving this
        job.emit_event({"type": "done", "status": "done", "results": job.results})

        logger.info(
            "Job %s completed: %d docs, %d chunks, failed=%s",
            job.job_id, docs_count, chunks_count, failed,
        )

    except Exception as exc:
        job.status = "error"
        error_msg = str(exc)

        # Emit terminal error event
        job.emit_event({
            "type": "error",
            "status": "error",
            "error": error_msg,
        })

        logger.exception("Job %s failed: %s", job.job_id, exc)
