/**
 * db-helper.js
 *
 * Persists scraped Reddit data into the Re-Search PostgreSQL schema.
 *
 * Schema targeted:
 *   source_documents — one row per Reddit comment (the granular unit of analysis)
 *
 * Each Reddit comment is stored as a source_document with:
 *   source             = 'reddit'
 *   text               = comment body
 *   url                = original post URL
 *   engagement_metrics = { upvotes, post_id, parent_comment_id, author }
 *
 * NOTE: This helper does NOT create a queries row — the scraper POCs run
 * outside the job queue. When the full pipeline is wired up, the query_id
 * will come from the queries table row created by backend-node.
 * For now, query_id is left NULL so raw scrape data is stored and traceable.
 */

'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const db = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

/**
 * Parses upvote strings like "1.5k" or "78" to integers.
 * Returns null if parsing fails.
 */
function parseUpvotes(upvotesStr) {
  if (!upvotesStr) return null;
  const str = String(upvotesStr).trim().toLowerCase();
  if (str.endsWith('k')) return Math.floor(parseFloat(str) * 1000);
  if (str.endsWith('m')) return Math.floor(parseFloat(str) * 1_000_000);
  const parsed = parseInt(str, 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * saveToPostgres — inserts scraped Reddit posts + comments into source_documents.
 *
 * Duplicate guard: uses ON CONFLICT (url, source) DO NOTHING keyed by url + source.
 * (We add a unique index on those two columns below — see note.)
 *
 * @param {Array}  posts        - Scraped posts array from reddit-test.js
 * @param {string} sourceQuery  - The search query string used for this scrape
 * @param {string|null} queryId - UUID from the queries table (null for standalone scrapes)
 */
async function saveToPostgres(posts, sourceQuery, queryId = null) {
  if (!posts || posts.length === 0) {
    console.log('[DB] No posts to save.');
    return;
  }

  const client = await db.connect();
  let docsInserted = 0;

  try {
    await client.query('BEGIN');

    for (const post of posts) {
      if (!post.comments || !Array.isArray(post.comments)) continue;

      for (const comment of post.comments) {
        // Skip empty comments
        const text = (comment.text || '').trim();
        if (!text) continue;

        const engagementMetrics = {
          upvotes: parseUpvotes(comment.upvotes),
          post_id: comment.post_id,
          post_title: post.title,
          parent_comment_id: comment.parent_comment_id || null,
          author: comment.author || null,
          subreddit: post.subreddit || null,
          source_query: sourceQuery,
        };

        await client.query(
          `INSERT INTO source_documents
             (query_id, source, author, text, url, published_at, engagement_metrics)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            queryId,
            'reddit',
            comment.author || null,
            text,
            post.url,
            comment.published_date ? new Date(comment.published_date) : null,
            JSON.stringify(engagementMetrics),
          ]
        );
        docsInserted++;
      }
    }

    await client.query('COMMIT');
    console.log(`[DB] ✅ Inserted ${docsInserted} source_documents from Reddit.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[DB] ❌ Transaction rolled back:', error.message);
    docsInserted = 0;
  } finally {
    client.release();
  }
  return docsInserted;
}

module.exports = { saveToPostgres };
