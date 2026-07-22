# Python FastAPI Service Contract

This document defines the interface between the Node.js API Gateway and the upcoming Python FastAPI service. The Node service acts as an orchestrator and client, while the Python service executes the LangGraph pipelines.

## 1. Job Submission
**Endpoint**: `POST /api/v1/jobs`

**Request Payload**:
```json
{
  "jobId": "uuid-v4-string",
  "userId": "uuid-v4-string",
  "queryText": "string",
  "sources": ["reddit", "youtube"] // Optional, defaults to all if empty
}
```
* **Required**: `jobId`, `userId`, `queryText`
* **Optional**: `sources`

**Response**:
* **202 Accepted**: Job successfully enqueued/started.
  ```json
  {
    "jobId": "uuid-v4-string",
    "status": "pending",
    "message": "Job accepted"
  }
  ```
* **400 Bad Request**: Invalid payload shape.
* **409 Conflict**: Job already exists.

---

## 2. Job Status Polling
**Endpoint**: `GET /api/v1/jobs/{jobId}/status`

**Response**:
* **200 OK**:
  ```json
  {
    "jobId": "uuid-v4-string",
    "status": "running", // "pending" | "running" | "done" | "error"
    "sources_failed": ["reddit"], // Optional, array of failed sources
    "results": {} // Optional, populated only if status is "done"
  }
  ```
* **404 Not Found**: Job does not exist.

---

## 3. Streaming Progress (SSE)
**Endpoint**: `GET /api/v1/jobs/{jobId}/stream`

**Format**: Server-Sent Events (SSE). The Python service should stream progress as LangGraph nodes execute.

**Event Schema**:
```json
{
  "type": "progress",     // "connected" | "progress" | "done" | "error"
  "jobId": "uuid-v4-string",
  "source": "youtube",    // Optional, current scraper source
  "status": "started",    // "started" | "done" | "error"
  "counts": {             // Optional, metric counts
    "docsInserted": 5
  },
  "error": "Error msg",   // Optional, only if type/status is "error"
  "timestamp": "ISO-8601 string"
}
```

**Terminal Events**:
* A `type: "done"` or `type: "error"` event indicates the job is fully complete or fatally failed. The Node client will close the connection upon receiving a terminal event.

---

## 4. Final Result Retrieval
**Endpoint**: `GET /api/v1/jobs/{jobId}/result`

**Response**:
* **200 OK**:
  ```json
  {
    "jobId": "uuid-v4-string",
    "report": { ... } // The finalized structured data
  }
  ```
* **404 Not Found**: Job not found or not yet complete.
