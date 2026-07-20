/**
 * claim-extractor.js
 *
 * LLM-based claim extraction pipeline for Reddit data.
 *
 * Flow:
 *   1. Pull up to 20 comments (cleaned_text) from Postgres.
 *   2. Apply a lightweight pre-filter (cost gate) on each comment.
 *   3. Send surviving text to Groq (llama-3.3-70b-versatile) with a
 *      strict JSON-only prompt.
 *   4. Parse + validate the LLM response.
 *   5. Print raw per-comment results for review. No DB write yet.
 *
 * Setup:
 *   Fill in GROQ_API_KEY + PG* vars in .env, then:
 *   node claim-extractor.js
 */

'use strict';

require('dotenv').config();
const Groq = require('groq-sdk');
const { Pool } = require('pg');

// ──────────────────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────────────────

const MODEL = 'llama-3.3-70b-versatile';  // better schema faithfulness (entities)
const BATCH_LIMIT = 20;                // max comments to process
const BATCH_SIZE = 5;                  // comments per LLM call (amortises system prompt cost)
const MIN_UPVOTES_FILTER = -Infinity;  // soft filter; set to e.g. 5 at volume
const MIN_WORD_COUNT = 5;              // skip if fewer words than this

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const db = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE,
  user:     process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

// ──────────────────────────────────────────────────────────────────────────
// 1. Pre-filter
// ──────────────────────────────────────────────────────────────────────────

/**
 * Returns { pass: boolean, reason: string }
 *
 * This is a COST gate only. It does NOT determine whether a claim exists —
 * it only skips text that is virtually guaranteed to contain nothing useful.
 */
function preFilter(comment) {
  const text = (comment.cleaned_text || comment.text || '').trim();

  // Empty / null text
  if (!text) {
    return { pass: false, reason: 'empty text' };
  }

  // Under minimum word count
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount < MIN_WORD_COUNT) {
    return { pass: false, reason: `too short (${wordCount} words)` };
  }

  // Pure question heuristic: every sentence ends with '?' or starts question word, no declarative
  const sentences = text
    .split(/[.!?\n]+/)
    .map(s => s.trim())
    .filter(Boolean);

  const questionWords = /^(what|who|where|when|why|how|is|are|was|were|do|does|did|can|could|should|would|will)\b/i;
  const isPureQuestion =
    sentences.length > 0 &&
    sentences.every(s => s.endsWith('?') || questionWords.test(s));

  if (isPureQuestion) {
    return { pass: false, reason: 'pure question' };
  }

  // Low upvotes at volume (disabled for test run but wired up for production)
  const upvotes = parseInt(comment.upvotes ?? 0, 10);
  if (!isNaN(upvotes) && upvotes < MIN_UPVOTES_FILTER) {
    return { pass: false, reason: `low upvotes (${upvotes})` };
  }

  return { pass: true, reason: 'ok' };
}

// ──────────────────────────────────────────────────────────────────────────
// 2. LLM prompt + call
// ──────────────────────────────────────────────────────────────────────────

// Compact prompt — no is_sincere, no direction (saves ~60 tokens per call)
const SYSTEM_PROMPT = `Extract claims from Reddit comments. Return a JSON array only — no prose, no fences.
A claim = declarative assertion about an entity (effectiveness, warning, opinion, factual, comparison).
Skip: questions, greetings, filler, meta-commentary.
Resolve pronouns using parent context if provided; omit claim if reference is unresolvable.
Schema per claim: {"claim_text":string,"entities":string[],"claim_type":"comparison"|"effectiveness"|"warning"|"opinion"|"factual","confidence":"high"|"medium"|"low","source_comment_id":string}
confidence: high=no hedge, medium="I think"/"seems", low="might"/"could".
If no claims, return [].`;

/**
 * extractClaimsBatch — sends up to BATCH_SIZE comments in one LLM call.
 * Each comment entry in the user message includes its ID, optional parent
 * context, and text. The model returns a flat JSON array of claims.
 *
 * @param {Array} batch  — array of comment objects that passed preFilter
 * @returns {{ rawResponse, claims, parseError }}
 */
async function extractClaimsBatch(batch) {
  // Build a compact multi-comment user message
  const userMessage = batch.map(c => {
    const text = (c.cleaned_text || c.text || '').trim();
    const parent = (c.parent_text || '').trim();
    let entry = `[ID:${c.id}]`;
    if (parent) entry += ` (parent: "${parent.slice(0, 120)}")`;  // truncate long parents
    entry += `\n${text}`;
    return entry;
  }).join('\n---\n');

  let rawResponse = '';
  let claims = [];
  let parseError = null;

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      temperature: 0.1,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    });

    rawResponse = completion.choices[0]?.message?.content?.trim() ?? '';

    const cleaned = rawResponse
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    claims = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    parseError = err.message;
  }

  return { rawResponse, claims, parseError };
}

// ──────────────────────────────────────────────────────────────────────────
// 4. Persistence
// ──────────────────────────────────────────────────────────────────────────

/**
 * saveClaimsToDb — persists one batch's claims for a single source_comment_id.
 *
 * Duplicate guard: if any row already exists for source_comment_id, we skip
 * ALL inserts for that comment and log a notice. This is safe to call on every
 * re-run against the same test sample.
 *
 * @param {string}   sourceCommentId  — e.g. "t1_ipxtyld"
 * @param {Array}    claims           — claim objects for this comment
 * @param {string}   sourcePlatform   — "reddit" | "youtube" | ...
 * @param {string}   rawLlmResponse   — raw JSON string from LLM for the whole batch
 * @returns {{ inserted: number, skipped: boolean }}
 */
async function saveClaimsToDb(sourceCommentId, claims, sourcePlatform, rawLlmResponse) {
  // Duplicate guard — check if this comment was already persisted
  const { rows } = await db.query(
    'SELECT 1 FROM extracted_claims WHERE source_comment_id = $1 LIMIT 1',
    [sourceCommentId]
  );

  if (rows.length > 0) {
    console.log(`  [DB] ${sourceCommentId} already persisted, skipping.`);
    return { inserted: 0, skipped: true };
  }

  if (claims.length === 0) return { inserted: 0, skipped: false };

  // Wrap all inserts for this comment in a single transaction
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    for (const claim of claims) {
      await client.query(
        `INSERT INTO extracted_claims
           (claim_text, entities, claim_type, direction, confidence,
            is_sincere, source_comment_id, source_platform, raw_llm_response)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          claim.claim_text,
          JSON.stringify(claim.entities ?? []),          // JSONB
          claim.claim_type,
          claim.direction ?? null,
          claim.confidence,
          claim.is_sincere ?? true,
          sourceCommentId,
          sourcePlatform,
          rawLlmResponse ? JSON.stringify(JSON.parse(rawLlmResponse)) : null,  // JSONB
        ]
      );
    }

    await client.query('COMMIT');
    console.log(`  [DB] Inserted ${claims.length} claim(s) for ${sourceCommentId}.`);
    return { inserted: claims.length, skipped: false };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`  [DB] Transaction rolled back for ${sourceCommentId}:`, err.message);
    return { inserted: 0, skipped: false };
  } finally {
    client.release();
  }
}


async function fetchComments() {
  const fs = require('fs');
  const path = require('path');
  const args = process.argv.slice(2);
  let fileArg = args.find(a => a.endsWith('.json'));

  // Default to reddit-results.json if it exists in the current directory and no arg was provided
  if (!fileArg && fs.existsSync(path.resolve(process.cwd(), 'reddit-results.json'))) {
    fileArg = 'reddit-results.json';
  }

  if (fileArg) {
    const filePath = path.resolve(process.cwd(), fileArg);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      let comments = [];
      for (const post of data) {
        if (post.comments && Array.isArray(post.comments)) {
          comments = comments.concat(post.comments.map(c => ({
            id: c.id,
            post_id: c.post_id,
            parent_comment_id: c.parent_comment_id,
            author: c.author,
            upvotes: c.upvotes,
            text: c.text,
            cleaned_text: c.text, // mapping text directly
            parent_text: c.parent_comment_id ? post.comments.find(p => p.id === c.parent_comment_id)?.text : post.body
          })));
        }
      }
      return comments.slice(0, BATCH_LIMIT);
    }
  }

  const query = `
    SELECT
      rc.id,
      rc.post_id,
      rc.parent_comment_id,
      rc.author,
      rc.upvotes,
      rc.text,
      rc.cleaned_text
    FROM reddit_comments rc
    ORDER BY rc.id
    LIMIT $1
  `;
  const { rows } = await db.query(query, [BATCH_LIMIT]);
  return rows;
}

// ──────────────────────────────────────────────────────────────────────────
// 4. Main
// ──────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=============================================================');
  console.log(' CLAIM EXTRACTION -- RAW OUTPUT (review before persistence)');
  console.log('=============================================================\n');

  let comments;
  try {
    comments = await fetchComments();
    console.log(`Fetched ${comments.length} comments. Batching ${BATCH_SIZE} per LLM call.\n`);
  } catch (err) {
    console.error('DB error:', err.message);
    console.error('Make sure your PG* environment variables are set in .env');
    process.exit(1);
  }

  if (comments.length === 0) {
    console.log('No comments returned from DB. Make sure reddit_comments is populated.');
    process.exit(0);
  }

  const summary = {
    total: comments.length,
    filtered: 0,
    batchesSent: 0,
    claimsFound: 0,
    claimsInserted: 0,
    claimsSkippedDuplicate: 0,
    parseErrors: 0,
  };

  // ── Pre-filter pass ────────────────────────────────────────────────────
  const eligible = [];   // comments that survive the pre-filter
  for (const comment of comments) {
    const { pass, reason } = preFilter(comment);
    if (!pass) {
      console.log(`SKIP [${comment.id}] -- ${reason}`);
      summary.filtered++;
    } else {
      eligible.push(comment);
    }
  }

  console.log(`\n${eligible.length} comments pass pre-filter. Sending to LLM in batches of ${BATCH_SIZE}...\n`);

  // ── Batch LLM calls ────────────────────────────────────────────────────
  for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
    const batch = eligible.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(eligible.length / BATCH_SIZE);

    console.log(`-------------------------------------------------------------`);
    console.log(`Batch ${batchNum}/${totalBatches} — comments: ${batch.map(c => c.id).join(', ')}`);
    console.log(`Calling Groq (${MODEL})...`);

    const { rawResponse, claims, parseError } = await extractClaimsBatch(batch);

    console.log('\n  -- RAW LLM RESPONSE --');
    console.log(rawResponse || '(empty)');
    console.log('  ----------------------');

    if (parseError) {
      console.log(`\n  PARSE ERROR: ${parseError}`);
      summary.parseErrors++;
    } else if (claims.length === 0) {
      console.log('\n  No claims extracted.');
    } else {
      console.log(`\n  ${claims.length} claim(s):`);
      claims.forEach((claim, ci) => {
        console.log(`\n    [${ci + 1}] src=${claim.source_comment_id}`);
        console.log(`      claim_text : ${claim.claim_text}`);
        console.log(`      entities   : ${JSON.stringify(claim.entities)}`);
        console.log(`      claim_type : ${claim.claim_type}`);
        console.log(`      confidence : ${claim.confidence}`);
      });
      summary.claimsFound += claims.length;

      // ── Persist: group claims by source_comment_id, one transaction each
      const byComment = {};
      for (const claim of claims) {
        const cid = claim.source_comment_id;
        if (!byComment[cid]) byComment[cid] = [];
        byComment[cid].push(claim);
      }
      for (const [cid, commentClaims] of Object.entries(byComment)) {
        const { inserted, skipped } = await saveClaimsToDb(
          cid, commentClaims, 'reddit', rawResponse
        );
        summary.claimsInserted += inserted;
        if (skipped) summary.claimsSkippedDuplicate += commentClaims.length;
      }
    }

    summary.batchesSent++;
    console.log('');
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log('=============================================================');
  console.log(' SUMMARY');
  console.log('=============================================================');
  console.log(`  Total comments fetched    : ${summary.total}`);
  console.log(`  Skipped by pre-filter     : ${summary.filtered}`);
  console.log(`  Batches sent to LLM       : ${summary.batchesSent}`);
  console.log(`  Parse errors              : ${summary.parseErrors}`);
  console.log(`  Total claims extracted    : ${summary.claimsFound}`);
  console.log(`  Claims newly inserted     : ${summary.claimsInserted}`);
  console.log(`  Claims skipped (duplicate): ${summary.claimsSkippedDuplicate}`);
  console.log('=============================================================\n');

  await db.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
