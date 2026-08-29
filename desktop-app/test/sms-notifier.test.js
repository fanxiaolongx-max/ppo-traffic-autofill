import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../src/db.js';
import { SecretStore } from '../src/secret-store.js';
import { normalizeSmsMatch, SmsNotifier } from '../src/sms-notifier.js';

const logger = { info() {}, warn() {}, error() {} };
const baseConfig = { smsApiUrl: 'https://sms.example.test/messages', smsApiToken: '', smsTimeoutMs: 2_000, smsMaxAttempts: 2 };

function query(store, request, status = 'success') {
  const now = new Date().toISOString();
  const record = store.createQuery({ id: `qry_${Date.now()}_${Math.random()}`, requestId: null, traceId: `tr_${Math.random()}`, fingerprint: String(Math.random()), status: 'queued', progress: 0, step: 'queued', request, source: 'test', sourceIp: '127.0.0.1', deviceId: 'test-device', userAgent: 'test', createdAt: now });
  return store.updateQuery(record.id, status === 'success'
    ? { status, result: { totalFine: '400 جنيه', violationCount: 1 }, finishedAt: now }
    : { status, error: { code: 'OFFICIAL_ERROR', message: '官网拒绝了查询' }, finishedAt: now });
}

test('normalizes document and Arabic plate exact-match values', () => {
  assert.equal(normalizeSmsMatch('document', ' ec 8961802 '), 'EC8961802');
  assert.equal(normalizeSmsMatch('plate', 'أ ف س ٣٤١٣'), 'أفس3413');
  assert.equal(normalizeSmsMatch('plate', '3413 أ ف س'), 'أفس3413');
});

test('encrypts stored token, matches a query and sends once with a stable idempotency key', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-sms-test-'));
  const store = new Store(directory);
  const calls = [];
  const notifier = new SmsNotifier({
    store, logger, config: baseConfig, secretStore: new SecretStore(directory),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, async json() { return { message: { id: 'sms_test_1', status: 'queued' } }; } };
    }
  });
  try {
    notifier.configure({ enabled: true, apiUrl: baseConfig.smsApiUrl, token: 'sms_test_secret_token', rules: [{ id: 'rule_document_1', enabled: true, type: 'document', matchValue: 'EC8961802', to: '01017739088', template: '{plate} {violations}笔 {totalFine}' }] });
    const record = query(store, { letter1: 'أ', letter2: 'ف', letter3: 'س', plateNumber: '3413', documentNumber: 'EC8961802' });
    assert.equal(notifier.handleTerminal(record), 1);
    notifier.handleTerminal(record);
    for (let i = 0; i < 20 && store.listSmsDeliveries().items[0]?.status !== 'accepted'; i += 1) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(calls.length, 1);
    assert.match(calls[0].options.headers.authorization, /^Bearer sms_test_secret_token$/);
    assert.equal(calls[0].options.headers['idempotency-key'], `ppo-${record.id}-rule_document_1`);
    assert.deepEqual(JSON.parse(calls[0].options.body), { to: '01017739088', text: 'أ ف س 3413 1笔 400 جنيه' });
    assert.equal(store.listSmsDeliveries().items[0].providerMessageId, 'sms_test_1');
    assert.equal(store.getSetting('sms_notification_config').token, undefined);
    assert.equal(JSON.stringify(store.getSetting('sms_api_token_encrypted')).includes('sms_test_secret_token'), false);
  } finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('SMS API failures are recorded without changing the terminal query result', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-sms-failure-'));
  const store = new Store(directory);
  const notifier = new SmsNotifier({
    store, logger, config: { ...baseConfig, smsMaxAttempts: 1 }, secretStore: new SecretStore(directory),
    fetchImpl: async () => ({ ok: false, status: 400, async json() { return { error: { message: 'invalid recipient' } }; } })
  });
  try {
    notifier.configure({ enabled: true, apiUrl: baseConfig.smsApiUrl, token: 'sms_fake', rules: [{ id: 'rule_plate_123', type: 'plate', matchValue: 'أ ف س 3413', to: '01017739088' }] });
    const record = query(store, { letter1: 'أ', letter2: 'ف', letter3: 'س', plateNumber: '3413', documentNumber: 'EC8961802' }, 'failed');
    notifier.handleTerminal(record);
    for (let i = 0; i < 20 && store.listSmsDeliveries().items[0]?.status !== 'failed'; i += 1) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(store.listSmsDeliveries().items[0].error, 'invalid recipient');
    assert.equal(store.getQuery(record.id).status, 'failed');
    assert.equal(store.getQuery(record.id).error.message, '官网拒绝了查询');
  } finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
