'use strict';

/**
 * logger.js — Structured JSON logger for all scraper runs.
 *
 * Every log line is a JSON object written to stdout, making it easy to
 * pipe into log aggregators (Datadog, CloudWatch, etc.) or grep in dev.
 *
 * Schema:
 *   { level, timestamp, jobId?, source?, status?, message, counts?, error? }
 *
 * Usage:
 *   const logger = require('../shared/logger');
 *   logger.info({ jobId, source: 'reddit', message: 'Starting scrape', counts: { posts: 7 } });
 *   logger.warn({ jobId, source: 'youtube', message: 'Rate limited, retrying', error: err.message });
 *   logger.error({ jobId, source: 'reddit', message: 'Fatal failure', error: err.message });
 */

function log(level, data) {
  const entry = {
    level,
    timestamp: new Date().toISOString(),
    ...data,
    // Ensure error is always a string (not an Error object)
    ...(data.error instanceof Error ? { error: data.error.message, stack: data.error.stack } : {}),
  };
  // Use stderr for errors, stdout for everything else — works well with Docker / PM2
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(JSON.stringify(entry) + '\n');
}

const logger = {
  info:  (data) => log('info',  data),
  warn:  (data) => log('warn',  data),
  error: (data) => log('error', data),
  debug: (data) => {
    // Only emit debug lines when LOG_LEVEL=debug to avoid noise in production
    if (process.env.LOG_LEVEL === 'debug') log('debug', data);
  },
};

module.exports = logger;
