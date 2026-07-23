'use strict';

/**
 * @deprecated — Job execution now handled by backend-python (FastAPI + LangGraph).
 * This module is retained for emergency rollback only.
 *
 * To rollback: in query.controller.js, uncomment the researchWorker import
 * and switch submitQuery/retryJob back to calling addJob() instead of
 * pythonServiceClient.submitJob().
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * researchWorker.js — In-process job queue and worker.
 *
 * ADR: Why in-memory instead of BullMQ + Redis for v1?
 *   - The orchestration logic (and this queue) is slated to be migrated 
 *     to the Python FastAPI service in the next phase.
 *   - Introducing BullMQ and requiring a Redis deployment now would be 
 *     over-investing in throwaway infrastructure.
 *   - While this means jobs are lost if the Node process restarts, the
 *     client (or user) can easily retry failed/lost jobs using the
 *     existing retry endpoint, which gracefully resumes via checkpoints.
 *   - We accept this temporary limitation for v1 to accelerate the Python migration.
 *
 * DESIGN:
 *   - Jobs are stored in a simple array queue (FIFO).
 *   - A single async worker loop runs one job at a time.
 *   - Each job runs the Reddit and/or YouTube scraper (based on sources[]).
 *   - SSE progress events are emitted via the exported EventEmitter so
 *     query.controller.js can fan them out to connected clients.
 *   - Job status is persisted to the `queries` table in Postgres.
 *   - On failure, the job is marked 'error' in the DB; the checkpoint
 *     persists so a retry resumes from where it failed.
 *
 * USAGE (in app.js):
 *   const { startWorker, addJob, jobEvents } = require('./workers/researchWorker');
 *   startWorker();   // call once on boot
 *
 * ADDING A JOB (in query.controller.js):
 *   addJob({ jobId, userId, queryText, sources });
 */

const { EventEmitter } = require('events');
const db = require('../db/client');
const logger = require('../../../shared/logger');

// ── Shared EventEmitter for SSE fan-out ──────────────────────────────────────
// query.controller.js listens to this emitter and forwards events to SSE clients.
const jobEvents = new EventEmitter();
jobEvents.setMaxListeners(100); // Allow many concurrent SSE listeners

// ── In-memory FIFO queue ─────────────────────────────────────────────────────
const queue = [];
let isProcessing = false;

/**
 * Add a job to the queue.
 * @param {{ jobId: string, userId: string, queryText: string, sources: string[] }} job
 */
function addJob(job) {
  queue.push(job);
  logger.info({ jobId: job.jobId, source: 'worker', message: `Job enqueued`, queueLength: queue.length });
  // Kick the worker loop if it's idle
  if (!isProcessing) processNext();
}

// ── Worker loop ───────────────────────────────────────────────────────────────

async function processNext() {
  if (queue.length === 0) {
    isProcessing = false;
    return;
  }

  isProcessing = true;
  const job = queue.shift();
  const { jobId, queryText, sources } = job;

  logger.info({ jobId, source: 'worker', status: 'running', message: 'Worker picked up job', queryText });

  try {
    // Mark job as running in DB
    await db.query("UPDATE queries SET status = 'running' WHERE id = $1", [jobId]);

    const results = {};

    // ── Run Reddit scraper ──────────────────────────────────────────────────
    if (!sources || sources.includes('reddit')) {
      emit(jobId, { type: 'progress', source: 'reddit', status: 'started' });
      try {
        const redditResult = await runRedditScraper(jobId, queryText);
        results.reddit = { status: 'done', ...redditResult };
        emit(jobId, { type: 'progress', source: 'reddit', status: 'done', counts: redditResult });
      } catch (err) {
        results.reddit = { status: 'error', error: err.message };
        // Mark source as failed in DB (non-fatal — continue with other sources)
        await db.query(
          "UPDATE queries SET sources_failed = array_append(sources_failed, 'reddit') WHERE id = $1",
          [jobId]
        );
        emit(jobId, { type: 'progress', source: 'reddit', status: 'error', error: err.message });
        logger.error({ jobId, source: 'reddit', message: 'Reddit scrape failed in worker', error: err });
      }
    }

    // ── Run YouTube scraper ─────────────────────────────────────────────────
    if (!sources || sources.includes('youtube')) {
      emit(jobId, { type: 'progress', source: 'youtube', status: 'started' });
      try {
        const youtubeResult = await runYoutubeScraper(jobId, queryText);
        results.youtube = { status: 'done', ...youtubeResult };
        emit(jobId, { type: 'progress', source: 'youtube', status: 'done', counts: youtubeResult });
      } catch (err) {
        results.youtube = { status: 'error', error: err.message };
        await db.query(
          "UPDATE queries SET sources_failed = array_append(sources_failed, 'youtube') WHERE id = $1",
          [jobId]
        );
        emit(jobId, { type: 'progress', source: 'youtube', status: 'error', error: err.message });
        logger.error({ jobId, source: 'youtube', message: 'YouTube scrape failed in worker', error: err });
      }
    }

    // ── Mark job done ───────────────────────────────────────────────────────
    await db.query(
      "UPDATE queries SET status = 'done', completed_at = now() WHERE id = $1",
      [jobId]
    );
    emit(jobId, { type: 'done', status: 'done', results });
    logger.info({ jobId, source: 'worker', status: 'done', message: 'Job completed', results });

  } catch (err) {
    // Unexpected top-level error — mark job as failed
    await db.query(
      "UPDATE queries SET status = 'error' WHERE id = $1",
      [jobId]
    ).catch(() => {});
    emit(jobId, { type: 'error', status: 'error', error: err.message });
    logger.error({ jobId, source: 'worker', status: 'error', message: 'Job failed with unexpected error', error: err });
  }

  // Process next job in queue (tail-call style, non-blocking)
  setImmediate(processNext);
}

// ── SSE emit helper ───────────────────────────────────────────────────────────

function emit(jobId, event) {
  jobEvents.emit(`job:${jobId}`, { ...event, jobId, timestamp: new Date().toISOString() });
}

// ── Scraper runners ───────────────────────────────────────────────────────────
// These lazy-require the scraper modules so the worker only loads Playwright
// and the YouTube API client when a job actually starts — not at boot time.

async function runRedditScraper(jobId, query) {
  const { scrape } = require('../../../reddit-collector/scraper');
  return scrape(jobId, query, jobId); // queryId = jobId (they're the same UUID)
}

async function runYoutubeScraper(jobId, query) {
  const { scrape } = require('../../../youtube-collector/scraper');
  return scrape(jobId, query, jobId);
}

// ── Start / status ────────────────────────────────────────────────────────────

function startWorker() {
  logger.info({ source: 'worker', message: 'In-memory research worker started. Ready to process jobs.' });
}

function getQueueLength() {
  return queue.length;
}

// ── Graceful Shutdown ─────────────────────────────────────────────────────────

process.on('SIGTERM', () => {
  if (isProcessing || queue.length > 0) {
    logger.warn({
      source: 'worker',
      message: `SIGTERM received. Worker is going down with ${queue.length} jobs in queue and ${isProcessing ? '1' : '0'} job in-flight. These will need to be retried manually.`,
      queueLength: queue.length,
      isProcessing
    });
  }
});

module.exports = { startWorker, addJob, jobEvents, getQueueLength };
