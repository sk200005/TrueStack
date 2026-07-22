'use strict';     //
                  // It prevents common mistakes such as
                  // - using undeclared variables
                  // - assigning values incorrectly
                  // - other unsafe JavaScript behavior

/**
 * checkpoint.js — Per-job scrape progress persistence.
 *
 * Saves the ID of the last successfully processed item (post, video, etc.)
 * per (jobId, source) pair to the `job_checkpoints` table.
 *
 * On a retry or resume, the scraper calls loadCheckpoint() first and skips
 * any items whose IDs were already processed in a previous run.
 *
 * Table: job_checkpoints
 *   job_id     UUID     — the queries.id this scrape belongs to
 *   source     VARCHAR  — 'reddit' | 'youtube' | etc.
 *   last_id    TEXT     — last successfully saved platform item ID
 *   updated_at TIMESTAMPTZ
 *
 * Usage:
 *   const { saveCheckpoint, loadCheckpoint } = require('../shared/checkpoint');
 *
 *   // Load on start — returns null if no checkpoint exists yet
 *   const lastId = await loadCheckpoint(jobId, 'reddit');
 *
 *   // Save after each item is fully written to the DB
 *   await saveCheckpoint(jobId, 'reddit', post.post_id);
 */

require('dotenv').config();
const { Pool } = require('pg');      // A Pool manages multiple database connections instead of creating a new connection every time. 
                                      // This is more efficient for applications that make many database requests.

// Reuse the same PG config pattern as db-helper.js
const db = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'postgres',
  user:     process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

/**
 * Save (upsert) the last processed item ID for a job+source.
 * Uses INSERT … ON CONFLICT DO UPDATE so this is safe to call repeatedly.
 *
 * @param {string} jobId  — UUID from queries.id (may be null for standalone scrapes)
 * @param {string} source — 'reddit' | 'youtube' | …
 * @param {string} lastId — platform-native ID of the last successfully saved item
 */
async function saveCheckpoint(jobId, source, lastId) {
  if (!jobId) return; // Standalone (non-queued) scrape — no checkpoint needed
  await db.query(
    `INSERT INTO job_checkpoints (job_id, source, last_id, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (job_id, source)
     DO UPDATE SET last_id = EXCLUDED.last_id, updated_at = now()`,
    [jobId, source, lastId]
  );
}

/**
 * Load the last processed item ID for a job+source.
 * Returns null if no checkpoint has been saved yet (fresh job).
 *
 * @param {string} jobId  — UUID from queries.id
 * @param {string} source — 'reddit' | 'youtube' | …
 * @returns {Promise<string|null>}
 */
async function loadCheckpoint(jobId, source) {
  if (!jobId) return null;
  const { rows } = await db.query(
    'SELECT last_id FROM job_checkpoints WHERE job_id = $1 AND source = $2',
    [jobId, source]
  );
  return rows[0]?.last_id ?? null;
}

/**
 * Delete the checkpoint for a job+source (called on successful completion
 * so a re-run starts fresh rather than thinking it's resuming).
 */
async function clearCheckpoint(jobId, source) {
  if (!jobId) return;
  await db.query(
    'DELETE FROM job_checkpoints WHERE job_id = $1 AND source = $2',
    [jobId, source]
  );
}

module.exports = { saveCheckpoint, loadCheckpoint, clearCheckpoint };
