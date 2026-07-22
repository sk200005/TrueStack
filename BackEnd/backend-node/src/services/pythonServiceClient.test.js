const assert = require('assert');
const nock = require('nock');
const { submitJob, getJobStatus, getJobResult, streamJobProgress } = require('./pythonServiceClient');

const BASE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';
const JOB_ID = '123-uuid';

async function runTests() {
  console.log('Running pythonServiceClient contract tests...');

  // 1. Test Job Submission
  nock(BASE_URL)
    .post('/api/v1/jobs', {
      jobId: JOB_ID,
      userId: 'user1',
      queryText: 'test query',
      sources: ['reddit']
    })
    .reply(202, {
      jobId: JOB_ID,
      status: 'pending',
      message: 'Job accepted'
    });

  const submitRes = await submitJob({
    jobId: JOB_ID,
    userId: 'user1',
    queryText: 'test query',
    sources: ['reddit']
  });
  assert.strictEqual(submitRes.status, 'pending');
  assert.strictEqual(submitRes.jobId, JOB_ID);
  console.log('✅ submitJob works according to contract');

  // 2. Test Job Status Polling
  nock(BASE_URL)
    .get(`/api/v1/jobs/${JOB_ID}/status`)
    .reply(200, {
      jobId: JOB_ID,
      status: 'running'
    });

  const statusRes = await getJobStatus(JOB_ID);
  assert.strictEqual(statusRes.status, 'running');
  console.log('✅ getJobStatus works according to contract');

  // 3. Test Job Result
  nock(BASE_URL)
    .get(`/api/v1/jobs/${JOB_ID}/result`)
    .reply(200, {
      jobId: JOB_ID,
      report: { foo: 'bar' }
    });

  const resultRes = await getJobResult(JOB_ID);
  assert.deepStrictEqual(resultRes.report, { foo: 'bar' });
  console.log('✅ getJobResult works according to contract');

  // 4. Test SSE Stream
  nock(BASE_URL)
    .get(`/api/v1/jobs/${JOB_ID}/stream`)
    .reply(200, 'data: {"type":"progress","jobId":"123-uuid","status":"started"}\n\ndata: {"type":"done","jobId":"123-uuid"}\n\n', {
      'Content-Type': 'text/event-stream'
    });

  const events = [];
  const emitter = streamJobProgress(JOB_ID);
  
  await new Promise((resolve, reject) => {
    emitter.on('event', (data) => events.push(data));
    emitter.on('end', resolve);
    emitter.on('error', reject);
  });

  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].type, 'progress');
  assert.strictEqual(events[1].type, 'done');
  console.log('✅ streamJobProgress correctly parses SSE events');

  console.log('All pythonServiceClient tests passed!');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
