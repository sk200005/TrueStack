'use strict';

require('dotenv').config();
const axios = require('axios');

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

/**
 * Kick off the LangGraph pipeline for a query.
 * Called by the BullMQ worker when it picks up a job.
 *
 * @param {{ jobId, queryText, sources }} payload
 * @returns {Promise<{ jobId: string }>}
 */
async function runPipeline(payload) {
  const response = await axios.post(`${PYTHON_SERVICE_URL}/pipeline/run`, payload, {
    timeout: 10000,
  });
  return response.data;
}

/**
 * Poll the current status of a running pipeline job.
 *
 * @param {string} jobId
 * @returns {Promise<{ status, progress }>}
 */
async function getPipelineStatus(jobId) {
  const response = await axios.get(`${PYTHON_SERVICE_URL}/pipeline/status/${jobId}`, {
    timeout: 5000,
  });
  return response.data;
}

/**
 * Fetch the final report once the pipeline is complete.
 *
 * @param {string} jobId
 * @returns {Promise<object>} structured report
 */
async function getPipelineResult(jobId) {
  const response = await axios.get(`${PYTHON_SERVICE_URL}/pipeline/result/${jobId}`, {
    timeout: 10000,
  });
  return response.data;
}

module.exports = { runPipeline, getPipelineStatus, getPipelineResult };
