'use strict';

require('dotenv').config();
const { Queue } = require('bullmq');

/**
 * BullMQ producer — adds research jobs to the 'research' queue.
 * The actual worker (which calls FastAPI) will be a separate process.
 *
 * Connection: uses REDIS_URL env var, defaults to localhost:6379.
 */
const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

const researchQueue = new Queue('research', { connection });

researchQueue.on('error', (err) => {
  console.error('[Queue] BullMQ connection error:', err.message);
});

console.log('[Queue] researchQueue connected to Redis at', `${connection.host}:${connection.port}`);

module.exports = { researchQueue };
