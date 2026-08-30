import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../src/db.js';
import { SecretStore } from '../src/secret-store.js';
import { normalizeEgyptMobile, normalizeSmsMatch, periodicResultMessage, SmsNotifier } from '../src/sms-notifier.js';

const logger = { info() {}, warn() {}, error() {} };
const baseConfig = {
  smsApiUrl: 'https://sms.example.test/messages', smsApiToken: '', smsHealthUrl: '', smsHealthIntervalMs: 300_000, smsHealthTimeoutMs: 2_000, smsTimeoutMs: 2_000, smsMaxAttempts: 2,
  smsBindingCodeTtlMs: 600_000, smsBindingResendMs: 60_000, smsBindingVerifyAttempts: 5,
  smsBindingWindowMs: 86_400_000, smsBindingRequestsPerDeviceIp: 6,
  smsBindingPhonesPerDeviceIp: 3, smsBindingQueriesPerPhone: 5,
  smsScheduleDefaultHours: 168, smsScheduleMaxHours: 8_760,
  smsSchedulePollMs: 30_000, smsScheduleLeaseMs: 900_000, smsScheduleRetryMs: 900_000
};

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

test('normalizes Egyptian mobile numbers with or without the local zero prefix', () => {
  assert.equal(normalizeEgyptMobile('010 1234 5678'), '+201012345678');
  assert.equal(normalizeEgyptMobile('10-1234-5678'), '+201012345678');
  assert.equal(normalizeEgyptMobile('+20 15 1234 5678'), '+201512345678');
  assert.throws(() => normalizeEgyptMobile('01312345678'), error => error.code === 'INVALID_EGYPT_MOBILE');
});

test('formats periodic SMS as one concise change and cumulative summary line', () => {
  const record = {
    request: { letter1:'أ', letter2:'ف', plateNumber:'3413' },
    result: { violationCount:'٥', totalFine:'1,200 جنيه' }
  };
  assert.equal(periodicResultMessage(record, { violationCount:3, totalFine:'850 جنيه' }), '周期查询 أ ف 3413｜本期 +2笔 / +350 جنيه｜累计 5笔 / 1,200 جنيه');
  assert.equal(periodicResultMessage(record, { violationCount:'٥', totalFine:'1,200 جنيه' }), '周期查询 أ ف 3413｜本期无变化｜累计 5笔 / 1,200 جنيه');
  assert.equal(periodicResultMessage(record), '周期查询 أ ف 3413｜首次记录｜累计 5笔 / 1,200 جنيه');
});

test('requires OTP verification before enabling a user binding and sends the current result once', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-sms-binding-'));
  const store = new Store(directory);
  const calls = [];
  const notifier = new SmsNotifier({
    store, logger, config: baseConfig, secretStore: new SecretStore(directory),
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return { ok: true, status: 200, async json() { return { message: { id: `sms_${calls.length}`, status: 'queued' } }; } };
    }
  });
  try {
    notifier.configure({ enabled: true, apiUrl: baseConfig.smsApiUrl, token: 'sms_test_token', rules: [] });
    const record = query(store, { letter1: 'أ', letter2: 'ف', plateNumber: '3413', documentNumber: 'EC8961802' });
    const context = { deviceId: record.deviceId, sourceIp: record.sourceIp };
    assert.throws(() => notifier.requestBinding(record, context, '01012345678', 23), error => error.code === 'INVALID_SMS_SCHEDULE_INTERVAL');
    const pending = notifier.requestBinding(record, context, '01012345678');
    assert.equal(pending.status, 'pending');
    assert.equal(store.listVerifiedSmsBindings(record.fingerprint).length, 0);
    for (let i = 0; i < 30 && calls.length < 1; i += 1) await new Promise(resolve => setTimeout(resolve, 10));
    const code = calls[0].text.match(/(\d{6})/)[1];
    await assert.rejects(async () => notifier.verifyBinding(record, context, { bindingId: pending.bindingId, code: '999999' }), error => error.code === 'SMS_CODE_INVALID');
    const verified = notifier.verifyBinding(record, context, { bindingId: pending.bindingId, code });
    assert.equal(verified.status, 'verified');
    assert.equal(verified.intervalHours, 168);
    assert.ok(new Date(verified.nextRunAt).getTime() > Date.now() + 167 * 3_600_000);
    assert.equal(store.listVerifiedSmsBindings(record.fingerprint)[0].to, '+201012345678');
    assert.equal(notifier.bindingStatus(record, { deviceId:record.deviceId, sourceIp:'198.51.100.8' }).status, 'verified');
    assert.equal(notifier.bindingStatus(record, { deviceId:'different-device', sourceIp:record.sourceIp }).status, 'unbound');
    assert.equal(notifier.bindingStatus({ ...record, fingerprint:'different-query' }, context).status, 'unbound');
    const rescheduled = notifier.updateBindingSchedule(record, context, 24);
    assert.equal(rescheduled.intervalHours, 24);
    assert.ok(new Date(rescheduled.nextRunAt).getTime() > Date.now() + 23 * 3_600_000);
    for (let i = 0; i < 30 && store.listSmsDeliveries().items.some(item => item.status !== 'accepted'); i += 1) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(calls.length, 2);
    assert.match(calls[1].text, /总罚款 400 جنيه/);
  } finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('limits distinct binding numbers for one device and IP within the configured window', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-sms-binding-limit-'));
  const store = new Store(directory);
  const notifier = new SmsNotifier({
    store, logger, config: { ...baseConfig, smsBindingPhonesPerDeviceIp: 2 }, secretStore: new SecretStore(directory),
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { message: { status: 'queued' } }; } })
  });
  try {
    notifier.configure({ enabled: true, apiUrl: baseConfig.smsApiUrl, token: 'sms_test_token', rules: [] });
    const first = query(store, { letter1: 'أ', letter2: 'ف', plateNumber: '1001', documentNumber: 'EC8961802' });
    const second = query(store, { letter1: 'أ', letter2: 'ف', plateNumber: '1002', documentNumber: 'EC8961802' });
    const third = query(store, { letter1: 'أ', letter2: 'ف', plateNumber: '1003', documentNumber: 'EC8961802' });
    const context = { deviceId: first.deviceId, sourceIp: first.sourceIp };
    notifier.requestBinding(first, context, '01012345678');
    notifier.requestBinding(second, context, '01112345678');
    assert.throws(() => notifier.requestBinding(third, context, '01212345678'), error => error.code === 'SMS_BINDING_PHONE_LIMIT');
    for (let i = 0; i < 30 && store.listSmsDeliveries().items.some(item => !['accepted', 'failed'].includes(item.status)); i += 1) await new Promise(resolve => setTimeout(resolve, 10));
  } finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
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

test('admin can create, edit, pause, list and delete a verified phone binding', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-sms-admin-binding-'));
  const store = new Store(directory);
  const notifier = new SmsNotifier({
    store, logger, config: baseConfig, secretStore: new SecretStore(directory),
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { message: { status: 'queued' } }; } })
  });
  try {
    notifier.configure({ enabled: true, apiUrl: baseConfig.smsApiUrl, token: 'sms_test', rules: [] });
    const record = query(store, { letter1: 'أ', letter2: 'ف', plateNumber: '3413', documentNumber: 'EC8961802' });
    const created = notifier.adminCreateBinding(record, { phone: '01012345678', intervalHours: 168 });
    assert.equal(created.status, 'verified');
    assert.equal(created.to, '+201012345678');
    const unrelated = query(store, { letter1:'ب', letter2:'ج', plateNumber:'9000', documentNumber:'EC0000001' });
    store.createSmsBinding({ id:'smsb_unrelated', queryFingerprint:unrelated.fingerprint, queryId:unrelated.id, to:'+201212345678', deviceId:'other-device', sourceIp:'192.0.2.1', codeSalt:'salt', codeHash:'hash', intervalHours:168, expiresAt:new Date(Date.now()+60_000).toISOString(), resendAfter:new Date().toISOString() });
    const filtered = store.listSmsBindings({ query: record.id });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0].id, created.id);
    const updated = notifier.adminUpdateBinding(created.id, { phone: '01112345678', intervalHours: 24, status: 'paused' });
    assert.equal(updated.to, '+201112345678');
    assert.equal(updated.intervalHours, 24);
    assert.equal(updated.status, 'paused');
    assert.equal(store.claimDueSmsSchedule(new Date(Date.now() + 2 * 86_400_000).toISOString(), new Date(Date.now() + 3 * 86_400_000).toISOString()), null);
    assert.equal(store.deleteSmsBinding(created.id), true);
    assert.equal(store.getSmsBinding(created.id), null);
    for (let i = 0; i < 30 && store.listSmsDeliveries().items.some(item => !['accepted', 'failed'].includes(item.status)); i += 1) await new Promise(resolve => setTimeout(resolve, 10));
  } finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('scheduled and manual results compare with the last delivered result and only notify their owning binding', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-sms-periodic-result-'));
  const store = new Store(directory);
  const calls = [];
  const notifier = new SmsNotifier({
    store, logger, config: baseConfig, secretStore: new SecretStore(directory),
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return { ok:true, status:200, async json() { return { message:{ status:'queued' } }; } };
    }
  });
  try {
    notifier.configure({ enabled:true, apiUrl:baseConfig.smsApiUrl, token:'sms_test', rules:[] });
    const source = query(store, { letter1:'أ', letter2:'ف', plateNumber:'3413', documentNumber:'EC8961802' });
    const owner = notifier.adminCreateBinding(source, { phone:'01012345678', intervalHours:24 });
    store.createVerifiedSmsBinding({
      id:'smsb_other_recipient', queryFingerprint:source.fingerprint, queryId:source.id,
      to:'+201112345678', deviceId:'other-device', sourceIp:'192.0.2.2', intervalHours:24,
      initialResult:source.result
    });
    for (let i=0;i<30&&calls.length<1;i+=1) await new Promise(resolve=>setTimeout(resolve,10));

    const now=new Date().toISOString();
    const created=store.createQuery({
      id:'qry_periodic_delta',requestId:null,traceId:'tr_periodic_delta',fingerprint:source.fingerprint,
      status:'queued',progress:0,step:'queued',request:source.request,source:'scheduled_sms',
      sourceIp:source.sourceIp,deviceId:source.deviceId,userAgent:'scheduler',createdAt:now
    });
    const scheduled=store.updateQuery(created.id,{status:'success',result:{totalFine:'750 جنيه',violationCount:3},finishedAt:now});
    store.completeSmsSchedule(owner.id,{queryId:scheduled.id,nextRunAt:new Date(Date.now()+86_400_000).toISOString(),runAt:now});
    assert.equal(notifier.handleTerminal(scheduled),1);
    for (let i=0;i<30&&calls.length<2;i+=1) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(calls.length,2);
    assert.equal(calls[1].to,'+201012345678');
    assert.equal(calls[1].text,'周期查询 أ ف 3413｜本期 +2笔 / +350 جنيه｜累计 3笔 / 750 جنيه');
    assert.deepEqual(store.getSmsBinding(owner.id).lastResult,{totalFine:'750 جنيه',violationCount:3});

    const manualCreated=store.createQuery({
      id:'qry_manual_delta',requestId:`sms-manual:${owner.id}:12345`,traceId:'tr_manual_delta',fingerprint:source.fingerprint,
      status:'queued',progress:0,step:'queued',request:source.request,source:'manual_sms',
      sourceIp:source.sourceIp,deviceId:source.deviceId,userAgent:'admin test',createdAt:now
    });
    const manual=store.updateQuery(manualCreated.id,{status:'success',result:{totalFine:'900 جنيه',violationCount:4},finishedAt:now});
    assert.equal(notifier.handleTerminal(manual),1);
    for(let i=0;i<30&&calls.length<3;i+=1)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(calls[2].to,'+201012345678');
    assert.equal(calls[2].text,'周期查询 أ ف 3413｜本期 +1笔 / +150 جنيه｜累计 4笔 / 900 جنيه');
    const failedCreated=store.createQuery({
      id:'qry_manual_failed',requestId:`sms-manual:${owner.id}:12346`,traceId:'tr_manual_failed',fingerprint:source.fingerprint,
      status:'queued',progress:0,step:'queued',request:source.request,source:'manual_sms',
      sourceIp:source.sourceIp,deviceId:source.deviceId,userAgent:'admin test',createdAt:now
    });
    const failed=store.updateQuery(failedCreated.id,{status:'failed',error:{code:'QUERY_TIMEOUT',message:'查询超时'},finishedAt:now});
    assert.equal(notifier.handleTerminal(failed),1);
    for(let i=0;i<30&&calls.length<4;i+=1)await new Promise(resolve=>setTimeout(resolve,10));
    assert.match(calls[3].text,/查询失败：查询超时/);
    for(let i=0;i<30&&store.listSmsDeliveries().items.some(item=>!['accepted','failed'].includes(item.status));i+=1)await new Promise(resolve=>setTimeout(resolve,10));
  } finally { store.close(); fs.rmSync(directory,{recursive:true,force:true}); }
});

test('periodic SMS health checks report healthy and unavailable API states', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-sms-health-'));
  const store = new Store(directory);
  let healthy = true;
  const notifier = new SmsNotifier({
    store, logger, config: baseConfig, secretStore: new SecretStore(directory),
    fetchImpl: async (_url, options) => {
      assert.equal(options.method, 'GET');
      return { ok: healthy, status: healthy ? 200 : 503 };
    }
  });
  try {
    notifier.configure({ enabled: true, apiUrl: baseConfig.smsApiUrl, healthUrl: 'https://sms.example.test/health', token: 'sms_test', rules: [] });
    assert.equal((await notifier.checkHealth()).status, 'operational');
    healthy = false;
    const outage = await notifier.checkHealth();
    assert.equal(outage.status, 'outage');
    assert.equal(outage.code, 'SMS_HEALTH_HTTP_ERROR');
    assert.deepEqual(store.listServiceEvents(10).filter(event => event.component === 'sms').map(event => event.status), ['outage', 'operational']);
  } finally { notifier.stopHealthMonitor(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
