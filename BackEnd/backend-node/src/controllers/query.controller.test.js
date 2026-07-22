const assert = require('assert');
const proxyquire = require('proxyquire');

// Mock req and res
function mockReqRes(jobDbData) {
  const req = {
    params: { jobId: '123' },
    user: { userId: 'user1' }
  };
  
  let jsonResponse = null;
  let statusResponse = null;
  const res = {
    status: (code) => {
      statusResponse = code;
      return res;
    },
    json: (data) => {
      jsonResponse = data;
      return res;
    }
  };

  const next = (err) => {
    throw err;
  };

  const dbMock = {
    query: async (queryStr, params) => {
      if (queryStr.includes('SELECT id, query_text')) {
        return { rows: jobDbData ? [jobDbData] : [] };
      }
      if (queryStr.includes('UPDATE queries SET status')) {
        return { rowCount: 1 };
      }
      return { rows: [] };
    }
  };

  return { req, res, next, dbMock, getRes: () => ({ status: statusResponse, json: jsonResponse }) };
}

async function runTest() {
  console.log('Testing retryJob behavior...');

  let addedJob = null;
  
  // Create the controller using proxyquire to intercept `db` and `addJob`
  const getController = (dbMock) => proxyquire('./query.controller', {
    '../db/client': dbMock,
    '../workers/researchWorker': {
      addJob: (job) => {
        addedJob = job;
      },
      jobEvents: { on: () => {}, off: () => {} }
    }
  });

  // Test 1: Only failed sources are retried
  addedJob = null;
  const t1 = mockReqRes({
    id: '123',
    query_text: 'test query',
    status: 'error',
    sources_requested: ['reddit', 'youtube'],
    sources_failed: ['youtube'] // Reddit succeeded, YouTube failed
  });
  
  const controller1 = getController(t1.dbMock);
  await controller1.retryJob(t1.req, t1.res, t1.next);
  
  assert.strictEqual(t1.getRes().status, 202);
  assert.deepStrictEqual(addedJob.sources, ['youtube'], 
    'Failed test 1: Should only retry the failed source (youtube), not reddit');
  console.log('✅ Test 1 passed: Only failed sources are retried');

  // Test 2: If sources_failed is null/empty, all requested sources are retried (global crash fallback)
  addedJob = null;
  const t2 = mockReqRes({
    id: '124',
    query_text: 'test query 2',
    status: 'error',
    sources_requested: ['reddit', 'youtube'],
    sources_failed: null // Crash before source-level failure recorded
  });
  
  const controller2 = getController(t2.dbMock);
  await controller2.retryJob(t2.req, t2.res, t2.next);
  
  assert.strictEqual(t2.getRes().status, 202);
  assert.deepStrictEqual(addedJob.sources, ['reddit', 'youtube'], 
    'Failed test 2: Should retry all requested sources if sources_failed is null');
  console.log('✅ Test 2 passed: All sources retried when sources_failed is empty');
}

runTest().catch(console.error);
