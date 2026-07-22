'use strict';

require('dotenv').config();
const axios = require('axios');
const { EventEmitter } = require('events');

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';
const BASE_URL = `${PYTHON_SERVICE_URL}/api/v1/jobs`;

/**
 * @typedef {Object} JobPayload
 * @property {string} jobId
 * @property {string} userId
 * @property {string} queryText
 * @property {string[]} [sources]
 */

/**
 * Submit a job to the Python FastAPI service.
 * @param {JobPayload} payload
 * @returns {Promise<{ jobId: string, status: string, message: string }>}
 */
async function submitJob(payload) {
  const response = await axios.post(BASE_URL, payload, {
    timeout: 10000,
  });
  return response.data; // { jobId, status, message }
}

/**
 * Poll the current status of a running job.
 * @param {string} jobId
 * @returns {Promise<{ jobId: string, status: string, sources_failed?: string[], results?: object }>}
 */
async function getJobStatus(jobId) {
  const response = await axios.get(`${BASE_URL}/${jobId}/status`, {
    timeout: 5000,
  });
  return response.data;
}

/**
 * Fetch the final report result.
 * @param {string} jobId
 * @returns {Promise<{ jobId: string, report: object }>}
 */
async function getJobResult(jobId) {
  const response = await axios.get(`${BASE_URL}/${jobId}/result`, {
    timeout: 10000,
  });
  return response.data;
}

/**
 * Connect to the SSE stream of a job and return an EventEmitter.
 * Emits 'progress', 'done', 'error' events.
 * 
 * @param {string} jobId
 * @returns {EventEmitter}
 */
function streamJobProgress(jobId) {
  const emitter = new EventEmitter();
  
  axios({
    method: 'get',
    url: `${BASE_URL}/${jobId}/stream`,
    responseType: 'stream',
    timeout: 0, // No timeout for SSE
  }).then(response => {
    response.data.on('data', chunk => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            emitter.emit('event', data);
            
            // Terminal events
            if (data.type === 'done' || data.type === 'error') {
              emitter.emit('end');
              response.data.destroy();
            }
          } catch (err) {
            // ignore parse errors for partial chunks
          }
        }
      }
    });

    response.data.on('end', () => {
      emitter.emit('end');
    });

  }).catch(err => {
    emitter.emit('error', err);
  });

  return emitter;
}

module.exports = { submitJob, getJobStatus, getJobResult, streamJobProgress };
