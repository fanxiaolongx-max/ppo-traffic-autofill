import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryQueue, publicEvent, publicRecord } from '../src/queue.js';

const request = { letter1: 'أ', letter2: 'ف', letter3: 'س', plateNumber: '3413', ownerType: 'passport', documentNumber: 'EA8961802', country: '10206' };

test('public records mask documents and never expose request metadata', () => {
  const visible = publicRecord({
    id: 'q1', deviceId: 'private-device', sourceIp: '1.2.3.4', userAgent: 'secret-agent', geo: { country: 'Egypt', city: 'Cairo' },
    fingerprint: 'secret-fingerprint', request, result: { totalFine: '1000 جنيه', rawText: 'private page', diagnostic: { snapshotPath: '/private/result.json', screenshotPath: '/private/result.png', preSubmitScreenshotPath: '/private/before.png', reason: 'success' } },
    error: { message: 'failed', stack: 'private stack', diagnostic: { snapshotPath: '/private/file', reason: 'timeout' } }
  }, true);
  assert.equal(visible.deviceId, undefined);
  assert.equal(visible.sourceIp, undefined);
  assert.equal(visible.userAgent, undefined);
  assert.equal(visible.geo, undefined);
  assert.equal(visible.fingerprint, undefined);
  assert.equal(visible.request.documentNumber, 'EA*****02');
  assert.equal(visible.result.rawText, undefined);
  assert.equal(visible.result.diagnostic.snapshotPath, undefined);
  assert.deepEqual(visible.diagnostics, { before: true, after: true });
  assert.equal(visible.error.stack, undefined);
  assert.equal(visible.error.diagnostic.snapshotPath, undefined);
});

test('public queue snapshots expose global counts but only the current device records', () => {
  const records = new Map([
    ['running', { id: 'running', deviceId: 'device-a', status: 'running', request, progress: 60 }],
    ['mine', { id: 'mine', deviceId: 'device-b', status: 'queued', request, progress: 0 }],
    ['other', { id: 'other', deviceId: 'device-c', status: 'queued', request, progress: 0 }]
  ]);
  const store = { list: () => [], getQuery: id => records.get(id) };
  const queue = new QueryQueue({
    store, driver: {}, logger: { info() {}, warn() {}, error() {} }, broadcast() {},
    config: { queueMax: 10, estimatedTaskMs: 60_000 }
  });
  queue.running = true;
  queue.currentId = 'running';
  queue.pending = ['mine', 'other'];
  const snapshot = queue.publicSnapshot('device-b');
  assert.equal(snapshot.runningCount, 1);
  assert.equal(snapshot.queuedCount, 2);
  assert.equal(snapshot.running, null);
  assert.deepEqual(snapshot.queued.map(item => item.id), ['mine']);
  assert.equal(snapshot.queued[0].deviceId, undefined);
  assert.equal(snapshot.queued[0].queuePosition, 2);
});

test('public timeline events retain safe retry detail without diagnostics or requests', () => {
  const event = publicEvent({
    id: 1, event: 'query_updated', step: 'retrying_passport_format', progress: 42,
    createdAt: '2026-08-20T00:00:00.000Z',
    details: { detail: '第 2/2 次：已去除护照英文字母前缀后重试', attempt: 2, retryFormat: 'without_prefix', request, diagnostic: { path: '/private' } }
  });
  assert.equal(event.detail, '第 2/2 次：已去除护照英文字母前缀后重试');
  assert.equal(event.attempt, 2);
  assert.equal(event.retryFormat, 'without_prefix');
  assert.equal(event.request, undefined);
  assert.equal(event.diagnostic, undefined);
});

test('rejects new tasks while the official-site circuit is open', () => {
  const store = {
    list: () => [], getByRequestId: () => null, findRecentFingerprint: () => null
  };
  const queue = new QueryQueue({
    store, driver: {}, logger: { info() {}, warn() {}, error() {} }, broadcast() {},
    config: { queueMax: 10, dedupeWindowMs: 120_000, estimatedTaskMs: 60_000 }
  });
  queue.circuitOpenUntil = Date.now() + 60_000;
  assert.throws(() => queue.enqueue(request, { deviceId: 'device-a', source: 'test' }), error => error.code === 'CIRCUIT_OPEN' && error.retryAfterMs > 0);
});

test('rejects new tasks when the bounded queue is full', () => {
  const store = {
    list: () => [], getByRequestId: () => null, findRecentFingerprint: () => null
  };
  const queue = new QueryQueue({
    store, driver: {}, logger: { info() {}, warn() {}, error() {} }, broadcast() {},
    config: { queueMax: 1, dedupeWindowMs: 120_000, estimatedTaskMs: 60_000 }
  });
  queue.running = true;
  assert.throws(() => queue.enqueue(request, { deviceId: 'device-a', source: 'test' }), error => error.code === 'QUEUE_FULL' && error.retryAfterMs === 60_000);
});

test('an explicitly forced admin test query bypasses recent-result deduplication but keeps queue limits', () => {
  let created=null;
  const store={
    list:()=>[], getByRequestId:()=>({id:'request-duplicate'}), findRecentFingerprint:()=>({id:'fingerprint-duplicate'}),
    createQuery:value=>{created=value;return value;}, getQuery:()=>null
  };
  const queue=new QueryQueue({
    store,driver:{},logger:{info(){},warn(){},error(){}},broadcast(){},
    config:{queueMax:10,dedupeWindowMs:120_000,estimatedTaskMs:60_000}
  });
  queue.running=true;
  const result=queue.enqueue(request,{requestId:'sms-manual:test:1',deviceId:'device-a',source:'manual_sms',sourceIp:'127.0.0.1',userAgent:'test',force:true});
  assert.equal(result.reused,false);
  assert.equal(created.source,'manual_sms');
  assert.equal(queue.pending.length,1);
});
