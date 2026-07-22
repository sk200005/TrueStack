# Node Gateway Service

This is the Node.js API Gateway that sits in front of the upcoming Python FastAPI backend.

## Known Limitations (v1)

### In-Memory Job Queue
Currently, jobs are processed using an in-memory queue (`researchWorker.js`). 
- **Durability**: Jobs in-flight or waiting in the queue will be lost if the Node.js server restarts or crashes.
- **Why**: The job orchestration and queueing responsibilities are scheduled to be migrated to the Python FastAPI service in the next phase. Implementing BullMQ + Redis now would be over-investing in throwaway infrastructure.
- **Mitigation**: A `SIGTERM` handler is in place to log warnings if the worker shuts down with jobs in the queue. Clients can safely re-submit failed or lost jobs using the `/api/queries/:id/retry` endpoint, which gracefully resumes from the last successfully processed checkpoint.
