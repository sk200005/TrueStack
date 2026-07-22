'use strict';

/**
 * query.controller.js
 *
 * Handles research query lifecycle:
 *   POST /api/queries        — create job, enqueue via in-memory worker, return jobId immediately
 *   GET  /api/queries/:id/status  — poll DB for current job status
 *   GET  /api/queries/:id/stream  — SSE: receive live progress events from the worker
 *   POST /api/queries/:id/retry   — re-enqueue a failed job from its last checkpoint
 *
 * SSE Bridge:
 *   The in-memory worker (researchWorker.js) emits `job:<jobId>` events on `jobEvents`.
 *   This controller forwards those events to all connected SSE clients for that job.
 */

const db = require('../db/client');
const { addJob, jobEvents } = require('../workers/researchWorker');

/**
 * POST /api/queries
 * Validates input, writes a `queries` row, enqueues the job, returns jobId immediately.
 */
async function submitQuery(req, res, next) {
  try {
    const { queryText, sources } = req.body;
    const userId = req.user.userId;

    if (!queryText || typeof queryText !== 'string' || !queryText.trim()) {
      return res.status(400).json({ error: 'queryText is required' });
    }

    const sourcesRequested = Array.isArray(sources)
      ? sources
      : ['reddit', 'youtube'];

    // 1. Persist the query row — status starts as 'pending'
    const { rows } = await db.query(
      `INSERT INTO queries (user_id, query_text, status, sources_requested)
       VALUES ($1, $2, 'pending', $3)
       RETURNING id, query_text, status, created_at`,
      [userId, queryText.trim(), sourcesRequested]
    );
    const jobId = rows[0].id;

    // 2. Push job into the in-memory worker queue (non-blocking)
    addJob({ jobId, userId, queryText: queryText.trim(), sources: sourcesRequested });

    return res.status(202).json({
      jobId,
      status: 'pending',
      query: queryText.trim(),
      message: 'Job accepted. Poll /status or connect to /stream for progress.',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/queries/:jobId/status
 * Simple polling endpoint — returns the current row from the queries table.
 */
async function getJobStatus(req, res, next) {
  try {
    const { jobId } = req.params;
    const userId = req.user.userId;

    const { rows } = await db.query(
      `SELECT id, query_text, status, sources_requested, sources_failed, created_at, completed_at
       FROM queries
       WHERE id = $1 AND user_id = $2`,
      [jobId, userId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Job not found' });
    }

    return res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/queries/:jobId/stream
 *
 * SSE endpoint — the client opens this connection once and receives live
 * progress events as the worker processes the job.
 *
 * Event format: { type, jobId, source?, status?, counts?, error?, timestamp }
 *
 * The connection closes automatically when the worker emits type='done' or type='error'.
 */
function streamJobProgress(req, res) {
  const { jobId } = req.params;

  // SSE response headers
  res.set({
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no', // Disable Nginx buffering if behind a proxy
  });
  res.flushHeaders();

  // Send initial connection acknowledgement
  sendEvent(res, { type: 'connected', jobId });

  // Forward worker events to this SSE client
  const eventName = `job:${jobId}`;
  function onWorkerEvent(event) {
    sendEvent(res, event);
    // Auto-close SSE stream when the job reaches a terminal state
    if (event.type === 'done' || event.type === 'error') {
      res.end();
      jobEvents.off(eventName, onWorkerEvent);
    }
  }
  jobEvents.on(eventName, onWorkerEvent);

  // Clean up listener when the client disconnects early
  req.on('close', () => {
    jobEvents.off(eventName, onWorkerEvent);
  });
}

/**
 * POST /api/queries/:jobId/retry
 *
 * Re-enqueues a failed job. The scraper's checkpoint persists the last
 * successfully processed item, so the retry continues from that point
 * rather than restarting from scratch.
 *
 * Only jobs with status='error' can be retried.
 */
async function retryJob(req, res, next) {
  try {
    const { jobId } = req.params;
    const userId = req.user.userId;

    // Verify ownership and current status
    const { rows } = await db.query(
      `SELECT id, query_text, status, sources_requested
       FROM queries WHERE id = $1 AND user_id = $2`,
      [jobId, userId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = rows[0];
    if (job.status !== 'error') {
      return res.status(409).json({
        error: `Job cannot be retried in status '${job.status}'. Only 'error' jobs can be retried.`,
      });
    }

    // Reset DB status to 'pending' and clear sources_failed
    await db.query(
      "UPDATE queries SET status = 'pending', sources_failed = NULL, completed_at = NULL WHERE id = $1",
      [jobId]
    );

    // Determine which sources to actually retry.
    // If some sources failed, we only retry those. Otherwise (e.g. global worker crash),
    // we fall back to retrying all originally requested sources.
    const sourcesToRetry = (job.sources_failed && job.sources_failed.length > 0)
      ? job.sources_failed
      : job.sources_requested;

    // Re-enqueue (the checkpoint in job_checkpoints survives the reset,
    // so the scraper will resume from where it left off)
    addJob({
      jobId,
      userId,
      queryText: job.query_text,
      sources: sourcesToRetry,
    });

    return res.status(202).json({
      jobId,
      status: 'pending',
      message: 'Job re-enqueued. It will resume from the last checkpoint.',
    });
  } catch (err) {
    next(err);
  }
}

// ── SSE helper ────────────────────────────────────────────────────────────────

function sendEvent(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

module.exports = { submitQuery, getJobStatus, streamJobProgress, retryJob };
