import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../src/db.js';
import { SmsScheduleRunner } from '../src/sms-scheduler.js';

const logger = { info() {}, warn() {}, error() {} };

function successfulQuery(store, fingerprint = 'fingerprint-schedule') {
  const now = new Date().toISOString();
  const created = store.createQuery({
    id: `qry_${Math.random()}`, requestId: null, traceId: `tr_${Math.random()}`, fingerprint,
    status: 'queued', progress: 0, step: 'queued',
    request: { letter1: 'أ', letter2: 'ف', plateNumber: '3413', ownerType: 'passport', documentNumber: 'EC8961802', country: '10206' },
    source: 'test', sourceIp: '127.0.0.1', deviceId: 'schedule-device', userAgent: 'test', createdAt: now
  });
  return store.updateQuery(created.id, { status: 'success', result: { totalFine: '100 جنيه', violationCount: 1 }, finishedAt: now });
}

function dueBinding(store, query, intervalHours = 168) {
  const binding = store.createSmsBinding({
    id: `smsb_${Math.random()}`, queryFingerprint: query.fingerprint, queryId: query.id,
    to: '+201012345678', deviceId: query.deviceId, sourceIp: query.sourceIp,
    codeSalt: 'salt', codeHash: 'hash', intervalHours,
    expiresAt: new Date(Date.now() + 600_000).toISOString(), resendAfter: new Date().toISOString()
  });
  store.verifySmsBinding(binding.id);
  return store.deferSmsSchedule(binding.id, new Date(Date.now() - 1_000).toISOString());
}

test('scheduled queries yield to foreground work and enter the same queue one at a time', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-sms-scheduler-'));
  const store = new Store(directory);
  const query = successfulQuery(store);
  const binding = dueBinding(store, query, 24);
  const enqueued = [];
  let busy = true;
  const queue = {
    maintenance: false,
    snapshot: () => ({ running: busy ? { id: 'foreground' } : null, queued: [], circuit: {} }),
    enqueue(request, meta) {
      enqueued.push({ request, meta });
      busy = true;
      return { reused: false, record: { id: 'qry_scheduled', traceId: 'tr_scheduled' } };
    }
  };
  const runner = new SmsScheduleRunner({
    store, queue, notifier: { getConfig: () => ({ enabled: true, tokenConfigured: true }) }, logger,
    config: { smsSchedulePollMs: 30_000, smsScheduleLeaseMs: 900_000, smsScheduleRetryMs: 900_000 }
  });
  try {
    assert.equal(await runner.tick(), false);
    assert.equal(enqueued.length, 0);
    busy = false;
    assert.equal(await runner.tick(), true);
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0].meta.source, 'scheduled_sms');
    assert.equal(enqueued[0].meta.deviceId, query.deviceId);
    assert.deepEqual(enqueued[0].request, query.request);
    const updated = store.getSmsBinding(binding.id);
    assert.equal(updated.lastQueryId, 'qry_scheduled');
    assert.ok(new Date(updated.nextRunAt).getTime() > Date.now() + 23 * 3_600_000);
    assert.equal(runner.handleTerminal({ id:'qry_scheduled', traceId:'tr_scheduled', source:'scheduled_sms', status:'failed', error:{ code:'QUERY_TIMEOUT' } }), true);
    const retryAt = new Date(store.getSmsBinding(binding.id).nextRunAt).getTime();
    assert.ok(retryAt > Date.now() + 14 * 60_000 && retryAt < Date.now() + 16 * 60_000);
    assert.equal(await runner.tick(), false);
    assert.equal(enqueued.length, 1);
  } finally { runner.stop(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
