"""
tests/test_wikipedia_graph.py — End-to-end test for the Wikipedia pipeline.

Tests:
  1. The FastAPI /health endpoint works
  2. Job submission returns 202 with correct contract shape
  3. Job status endpoint returns the job state
  4. The wikipedia_fetch node actually fetches content (mocked or real)

NOTE: This test can run against a real Wikipedia API (no mock needed —
Wikipedia is public and free). It does NOT require a database connection
for the fetch test, but the full end-to-end test needs Postgres.
"""

import asyncio
import json
import sys
import os

import pytest
from fastapi.testclient import TestClient

# Ensure the app package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.main import app


client = TestClient(app)


def test_health():
    """Health endpoint returns OK."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "backend-python"


def test_submit_job_returns_202():
    """POST /api/v1/jobs returns 202 with contract-compliant response."""
    response = client.post("/api/v1/jobs", json={
        "jobId": "test-job-001",
        "userId": "test-user-001",
        "queryText": "Python programming language",
        "sources": ["wikipedia"],
    })
    assert response.status_code == 202
    data = response.json()
    assert data["jobId"] == "test-job-001"
    assert data["status"] == "pending"
    assert data["message"] == "Job accepted"


def test_submit_duplicate_job_returns_409():
    """Submitting the same jobId twice returns 409 Conflict."""
    payload = {
        "jobId": "test-job-duplicate",
        "userId": "test-user-001",
        "queryText": "test query",
        "sources": ["wikipedia"],
    }
    # First submission
    r1 = client.post("/api/v1/jobs", json=payload)
    assert r1.status_code == 202

    # Duplicate
    r2 = client.post("/api/v1/jobs", json=payload)
    assert r2.status_code == 409


def test_job_status_not_found():
    """GET /api/v1/jobs/{id}/status returns 404 for unknown job."""
    response = client.get("/api/v1/jobs/nonexistent-id/status")
    assert response.status_code == 404


def test_job_status_after_submit():
    """GET /api/v1/jobs/{id}/status returns the job state after submission."""
    job_id = "test-job-status"
    client.post("/api/v1/jobs", json={
        "jobId": job_id,
        "userId": "test-user-001",
        "queryText": "test",
        "sources": ["wikipedia"],
    })

    response = client.get(f"/api/v1/jobs/{job_id}/status")
    assert response.status_code == 200
    data = response.json()
    assert data["jobId"] == job_id
    assert data["status"] in ("pending", "running", "done", "error")


def test_job_result_not_found():
    """GET /api/v1/jobs/{id}/result returns 404 for unknown job."""
    response = client.get("/api/v1/jobs/nonexistent-id/result")
    assert response.status_code == 404


def test_sse_stream_format():
    """
    GET /api/v1/jobs/{id}/stream returns SSE-formatted events.

    Verifies the byte format that pythonServiceClient.js expects:
        data: <JSON>\n\n
    """
    job_id = "test-job-sse"
    client.post("/api/v1/jobs", json={
        "jobId": job_id,
        "userId": "test-user-001",
        "queryText": "test",
        "sources": ["wikipedia"],
    })

    # Give the background task a moment to emit events
    import time
    time.sleep(2)

    with client.stream("GET", f"/api/v1/jobs/{job_id}/stream") as response:
        assert response.status_code == 200
        assert "text/event-stream" in response.headers.get("content-type", "")

        # Read the first few chunks
        events = []
        for chunk in response.iter_text():
            lines = chunk.strip().split("\n")
            for line in lines:
                if line.startswith("data: "):
                    try:
                        data = json.loads(line[6:])
                        events.append(data)
                        # Stop after we get a terminal event
                        if data.get("type") in ("done", "error"):
                            break
                    except json.JSONDecodeError:
                        continue
            if events and events[-1].get("type") in ("done", "error"):
                break

        # Verify we got at least the connected event
        assert len(events) >= 1
        # All events must have jobId and type fields
        for event in events:
            assert "type" in event
            assert "jobId" in event
            assert "timestamp" in event


def test_wikipedia_node_directly():
    """Test the wikipedia_fetch node function directly (no DB needed)."""
    from app.graphs.nodes.wikipedia_node import wikipedia_fetch
    from app.graphs.state import ResearchState

    initial_state: ResearchState = {
        "job_id": "test-direct",
        "query": "Python programming language",
        "sources_to_fetch": ["wikipedia"],
        "raw_documents": [],
        "failed_sources": [],
        "status": "pending",
        "results": {},
    }

    # Run the async node synchronously for testing
    result = asyncio.get_event_loop().run_until_complete(
        wikipedia_fetch(initial_state)
    )

    docs = result.get("raw_documents", [])
    assert len(docs) > 0, "Should fetch at least one Wikipedia article"

    doc = docs[0]
    assert doc["source"] == "wikipedia"
    assert len(doc["text"]) > 100, "Article text should be substantial"
    assert doc["url"].startswith("https://"), "URL should be a valid Wikipedia link"
    print(f"  Fetched {len(docs)} articles, first: {doc['url']} ({len(doc['text'])} chars)")
