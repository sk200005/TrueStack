'use strict';

/**
 * retry.js — Exponential backoff retry wrapper.
 *
 * Wraps any async function and retries it on transient failures.
 * Retries on:
 *   - Network errors (ECONNRESET, ETIMEDOUT, etc.)
 *   - HTTP 429 Too Many Requests (rate limit)
 *   - HTTP 5xx Server Errors
 *
 * Does NOT retry on:
 *   - HTTP 4xx (except 429) — these are permanent client errors
 *   - Non-Error throws (unexpected — let them propagate immediately)
 *
 * @param {Function} fn             — async function to call (must return a Promise)
 * @param {object}   [options]
 * @param {number}   [options.maxRetries=3]    — max number of retry attempts
 * @param {number}   [options.baseDelayMs=500] — initial delay in ms; doubles each attempt
 * @param {string}   [options.label='']        — human-readable label for log messages
 * @returns {Promise<*>} result of fn() on success
 * @throws  last error if all retries are exhausted
 *
 * Usage:
 *   const { withRetry } = require('../shared/retry');
 *   const data = await withRetry(() => axios.get(url), { maxRetries: 3, label: 'fetch-reddit-post' });
 */

const logger = require('./logger');

/** Returns true for errors that are worth retrying. */
function isRetriable(err) {
  // Network-level errors
  const networkCodes = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'];
  if (networkCodes.includes(err.code)) return true;

  // HTTP errors — retry on 429 and 5xx only
  const status = err.response?.status;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;

  return false;
}

/** Returns the Retry-After header value in ms, if present. */
function retryAfterMs(err) {
  const header = err.response?.headers?.['retry-after'];
  if (!header) return null;
  const seconds = parseFloat(header);
  return isNaN(seconds) ? null : seconds * 1000;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, { maxRetries = 3, baseDelayMs = 500, label = '' } = {}) {
  let lastErr;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      // Don't retry non-retriable errors — fail immediately
      if (!isRetriable(err)) throw err;

      if (attempt === maxRetries) break; // exhausted — will throw below

      // Respect the server's Retry-After header if present (e.g. YouTube 429)
      const explicitDelay = retryAfterMs(err);
      const backoffDelay  = baseDelayMs * Math.pow(2, attempt);
      const delay         = explicitDelay ?? backoffDelay;

      logger.warn({
        message: `Retrying after ${delay}ms`,
        label,
        attempt: attempt + 1,
        maxRetries,
        error: err.message,
        httpStatus: err.response?.status,
      });

      await sleep(delay);
    }
  }

  // All retries exhausted
  throw lastErr;
}

module.exports = { withRetry };
