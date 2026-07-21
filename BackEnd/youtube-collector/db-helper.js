'use strict';

/**
 * db-helper.js — YouTube scrape DB writer.
 *
 * Mirrors reddit-collector/db-helper.js exactly.
 * Persists scraped YouTube data into the Re-Search PostgreSQL schema.
 *
 * Schema targeted: source_documents
 *   One row per YouTube comment  (source = 'youtube', engagement_metrics.type = 'comment')
 *   One row per video transcript (source = 'youtube', engagement_metrics.type = 'transcript')
 *
 * engagement_metrics stores all video-level metadata (views, likes, channel, etc.)
 * so every comment/transcript row is fully self-contained for downstream analysis.
 *
 * @param {Array}       videos      - Collected videos array from scraper.js
 * @param {string}      sourceQuery - The search query used for this scrape
 * @param {string|null} queryId     - UUID from queries.id (null for standalone scrapes)
 * @returns {Promise<number>} Number of source_document rows inserted
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

// Same connection pattern as reddit-collector/db-helper.js
const db = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'postgres',
  user:     process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

async function saveToPostgres(videos, sourceQuery, queryId = null) {
  if (!videos || videos.length === 0) {
    console.log('[DB-YouTube] No videos to save.');
    return 0;
  }

  const client = await db.connect();
  let docsInserted = 0;

  try {
    await client.query('BEGIN');

    for (const video of videos) {
      // Base engagement metrics shared by every row for this video
      const baseMetrics = {
        video_id:    video.videoId,
        video_title: video.title,
        channel:     video.channel,
        views:       video.views,
        likes:       video.likes,
        duration:    video.duration,
        source_query: sourceQuery,
      };

      // ── 1. Store transcript as a source_document ──────────────────────────
      const transcriptText = video.transcript?.english || video.transcript?.original || '';
      if (transcriptText.trim()) {
        await client.query(
          `INSERT INTO source_documents
             (query_id, source, author, text, url, published_at, engagement_metrics)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            queryId,
            'youtube',
            video.channel || null,
            transcriptText.trim(),
            video.url,
            video.publishedAt ? new Date(video.publishedAt) : null,
            JSON.stringify({ ...baseMetrics, type: 'transcript', language: video.transcript?.language }),
          ]
        );
        docsInserted++;
      }

      // ── 2. Store each comment as a source_document ────────────────────────
      if (Array.isArray(video.comments)) {
        for (const comment of video.comments) {
          const text = (comment.text || '').trim();
          if (!text) continue;

          await client.query(
            `INSERT INTO source_documents
               (query_id, source, author, text, url, published_at, engagement_metrics)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              queryId,
              'youtube',
              comment.author || null,
              text,
              video.url,
              comment.publishedAt ? new Date(comment.publishedAt) : null,
              JSON.stringify({ ...baseMetrics, type: 'comment', likes: comment.likes }),
            ]
          );
          docsInserted++;
        }
      }
    }

    await client.query('COMMIT');
    console.log(`[DB-YouTube] ✅ Inserted ${docsInserted} source_documents from YouTube.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[DB-YouTube] ❌ Transaction rolled back:', error.message);
    docsInserted = 0;
  } finally {
    client.release();
  }
  return docsInserted;
}

module.exports = { saveToPostgres };
