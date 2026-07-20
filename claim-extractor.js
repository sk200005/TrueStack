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

const MODEL = 'llama-3.3-70b-versatile';
const BATCH_LIMIT = 20;                // max comments to process
const MIN_UPVOTES_FILTER = -Infinity;  // soft filter; set to e.g. 5 at volume
const MIN_WORD_COUNT = 5;             // skip if fewer words than this

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

const SYSTEM_PROMPT = `You are a claim-extraction engine. Your ONLY job is to read a piece of Reddit text and return a JSON array of claims made in it.

RULES:
- A "claim" is any statement that asserts something about an entity: comparisons, effectiveness statements, factual assertions, warnings, or opinions.
- Questions by themselves are NOT claims. Extract only declarative assertions.
- DO NOT include meta-commentary or filler like "thanks" or greetings.
- If there are NO claims, return an empty array: []
- Return ONLY valid JSON. No markdown fences, no prose, no explanation.

OUTPUT SCHEMA (array of objects):
[
  {
    "claim_text": "exact or lightly paraphrased claim from the text",
    "entities": ["entity1", "entity2"],
    "claim_type": "comparison" | "effectiveness" | "warning" | "opinion" | "factual",
    "direction": "which entity wins (only for comparison), else null",
    "confidence": "high" | "medium" | "low",
    "source_comment_id": "__SOURCE_ID__"
  }
]

Confidence calibration:
- high   => stated as fact, no hedging ("Reddit's pricing is $20M/year")
- medium => mild hedge ("I think", "seems", "probably")
- low    => strong hedge ("might", "could", "I'm not sure but")`;

async function extractClaims(comment) {
  const text = (comment.cleaned_text || comment.text || '').trim();
  const sourceId = comment.id || 'unknown';

  let rawResponse = '';
  let parsed = null;
  let parseError = null;

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      temperature: 0.1,   // low temp => deterministic, schema-faithful
      max_tokens: 1024,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Source comment ID: ${sourceId}\n\nText:\n${text}`,
        },
      ],
    });

    rawResponse = completion.choices[0]?.message?.content?.trim() ?? '';

    // Strip markdown fences if the model added them despite instructions
    const cleaned = rawResponse
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    parsed = JSON.parse(cleaned);

    // Stamp the real source ID onto each claim
    if (Array.isArray(parsed)) {
      parsed = parsed.map(claim => ({
        ...claim,
        source_comment_id: sourceId,
      }));
    }
  } catch (err) {
    parseError = err.message;
  }

  return { rawResponse, parsed, parseError };
}

// ──────────────────────────────────────────────────────────────────────────
// 3. Fetch comments from Postgres
// ──────────────────────────────────────────────────────────────────────────

async function fetchComments() {
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
    console.log(`Fetched ${comments.length} comments from Postgres.\n`);
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
    processed: 0,
    claimsFound: 0,
    parseErrors: 0,
  };

  for (let i = 0; i < comments.length; i++) {
    const comment = comments[i];
    const text = (comment.cleaned_text || comment.text || '').trim();
    const label = `[${i + 1}/${comments.length}] id=${comment.id}`;

    console.log('-------------------------------------------------------------');
    console.log(label);
    console.log(`  author     : ${comment.author || '(unknown)'}`);
    console.log(`  upvotes    : ${comment.upvotes ?? 'n/a'}`);
    console.log(`  parent_id  : ${comment.parent_comment_id || 'null (top-level)'}`);
    console.log('  input text :');
    text.split('\n').forEach(line => console.log(`    ${line}`));

    // Pre-filter
    const { pass, reason } = preFilter(comment);

    if (!pass) {
      console.log(`\n  PRE-FILTER: SKIPPED -- ${reason}`);
      console.log('  claims      : (not sent to LLM)\n');
      summary.filtered++;
      continue;
    }

    console.log('\n  PRE-FILTER: PASSED');
    console.log(`  Calling Groq (${MODEL})...`);

    const { rawResponse, parsed, parseError } = await extractClaims(comment);

    console.log('\n  -- RAW LLM RESPONSE ------------------------------------------');
    console.log(rawResponse || '(empty)');
    console.log('  --------------------------------------------------------------');

    if (parseError) {
      console.log(`\n  PARSE ERROR: ${parseError}`);
      summary.parseErrors++;
    } else if (!Array.isArray(parsed) || parsed.length === 0) {
      console.log('\n  No claims extracted (empty array -- normal for non-claim text).');
    } else {
      console.log(`\n  ${parsed.length} claim(s) extracted:`);
      parsed.forEach((claim, ci) => {
        console.log(`\n    Claim ${ci + 1}:`);
        console.log(`      claim_text  : ${claim.claim_text}`);
        console.log(`      entities    : ${JSON.stringify(claim.entities)}`);
        console.log(`      claim_type  : ${claim.claim_type}`);
        console.log(`      direction   : ${claim.direction ?? 'null'}`);
        console.log(`      confidence  : ${claim.confidence}`);
        console.log(`      source_id   : ${claim.source_comment_id}`);
      });
      summary.claimsFound += parsed.length;
    }

    summary.processed++;
    console.log('');

    // Small delay to avoid Groq rate-limit on rapid fire calls
    if (i < comments.length - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Summary
  console.log('=============================================================');
  console.log(' SUMMARY');
  console.log('=============================================================');
  console.log(`  Total comments fetched : ${summary.total}`);
  console.log(`  Skipped by pre-filter  : ${summary.filtered}`);
  console.log(`  Sent to LLM            : ${summary.processed}`);
  console.log(`  Parse errors           : ${summary.parseErrors}`);
  console.log(`  Total claims extracted : ${summary.claimsFound}`);
  console.log('=============================================================\n');

  await db.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
