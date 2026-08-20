import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/db.js';

test('returns history in pages of twenty with a stable offset', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-history-test-'));
  try {
    const store = new Store(directory);
    for (let index = 0; index < 25; index += 1) {
      const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
      store.createQuery({
        id: `query-${index}`, traceId: `trace-${index}`, fingerprint: `fingerprint-${index}`,
        requestId: null, status: 'queued', progress: 0, step: 'queued',
        request: { plateNumber: String(index) }, source: 'test', sourceIp: '127.0.0.1',
        deviceId: 'test-device', userAgent: 'test', createdAt
      });
    }
    const firstPage = store.list(20, [], 0);
    const secondPage = store.list(20, [], 20);
    assert.equal(firstPage.length, 20);
    assert.equal(secondPage.length, 5);
    assert.equal(firstPage[0].id, 'query-24');
    assert.equal(secondPage[0].id, 'query-4');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('scopes history and deduplication to a single device', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-device-history-test-'));
  try {
    const store = new Store(directory);
    for (const deviceId of ['device-a', 'device-b']) {
      store.createQuery({
        id: `query-${deviceId}`, traceId: `trace-${deviceId}`, fingerprint: 'same-fingerprint',
        requestId: 'same-request-id', status: 'queued', progress: 0, step: 'queued',
        request: { plateNumber: '3413' }, source: 'test', sourceIp: '127.0.0.1',
        deviceId, userAgent: 'test', createdAt: new Date().toISOString()
      });
    }
    assert.deepEqual(store.listByDevice('device-a').map(item => item.id), ['query-device-a']);
    assert.equal(store.getByRequestId('same-request-id', 'device-b').id, 'query-device-b');
    assert.equal(store.findRecentFingerprint('same-fingerprint', '2020-01-01T00:00:00.000Z', 'device-a').id, 'query-device-a');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('stores service status history, metrics and searchable full admin records', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-admin-store-test-'));
  try {
    const store = new Store(directory);
    const createdAt = new Date().toISOString();
    store.createQuery({
      id: 'query-admin', traceId: 'tr_admin-search', fingerprint: 'fingerprint-admin', requestId: null,
      status: 'queued', progress: 0, step: 'queued',
      request: { letter1: 'أ', letter2: 'ف', letter3: 'س', plateNumber: '3413', documentNumber: 'EC123402', ownerType: 'passport' },
      source: 'test', sourceIp: '127.0.0.1', deviceId: 'admin-device', userAgent: 'test', createdAt
    });
    store.updateQuery('query-admin', { status: 'success', step: 'completed', result: { totalFine: '1000 جنيه', violationCount: 3 }, finishedAt: new Date().toISOString() });
    assert.equal(store.searchQueries({ query: 'أ ف س 3413' }).items[0].id, 'query-admin');
    assert.equal(store.searchQueries({ query: 'EC••••02' }).items[0].id, 'query-admin');
    assert.equal(store.searchQueries({ query: 'tr_admin-search' }).items[0].id, 'query-admin');
    store.addServiceEvent('official', 'operational', 'QUERY_SUCCESS', '官网查询成功');
    store.addServiceEvent('official', 'operational', 'QUERY_SUCCESS', '重复状态不会重复记录');
    store.addServiceEvent('rate_limit', 'warning', 'RATE_MINUTE', '触发流控', {}, { force: true });
    assert.equal(store.listServiceEvents().filter(event => event.component === 'official').length, 1);
    assert.equal(store.countServiceEvents('rate_limit', '2020-01-01T00:00:00.000Z'), 1);
    assert.equal(store.queryStatistics('2020-01-01T00:00:00.000Z').successRate, 100);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('paginates public service status records twenty at a time', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-status-pagination-test-'));
  try {
    const store = new Store(directory);
    for (let index = 0; index < 45; index += 1) {
      const component = index % 4 === 0 ? 'rate_limit' : (index % 2 === 0 ? 'official' : 'server');
      store.addServiceEvent(component, 'operational', `EVENT_${index}`, `event ${index}`, {}, { force: true });
    }
    const options = { limit:20, components:['server', 'official'] };
    const first = store.listServiceEventsPage(options);
    const second = store.listServiceEventsPage({ ...options, offset:20 });
    assert.equal(first.items.length, 20);
    assert.equal(first.hasMore, true);
    assert.equal(first.nextOffset, 20);
    assert.ok(second.items.length > 0 && second.items.length <= 20);
    assert.ok(first.items.every(item => ['server', 'official'].includes(item.component)));
    assert.ok(second.items.every(item => ['server', 'official'].includes(item.component)));
    assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, first.items.length + second.items.length);
  } finally {
    fs.rmSync(directory, { recursive:true, force:true });
  }
});

test('stores searchable feedback, client geography and admin settings', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-feedback-store-test-'));
  try {
    const store = new Store(directory);
    const createdAt = new Date().toISOString();
    store.createFeedback({ id:'fb_test', deviceId:'device-feedback', sourceIp:'8.8.8.8', userAgent:'Mobile Safari', phone:'+20 100 123', wechat:'wx-test', content:'希望增加查询提示', pageUrl:'https://query.example.com/', createdAt });
    store.setFeedbackGeo('fb_test', { country:'埃及', city:'开罗', isp:'Example ISP' });
    assert.equal(store.listFeedback({ query:'开罗' }).items[0].id, 'fb_test');
    assert.equal(store.listFeedback({ query:'device-feedback' }).total, 1);
    assert.equal(store.feedbackStatistics().unread, 1);
    assert.equal(store.updateFeedback('fb_test', { status:'resolved', adminNote:'已处理' }).status, 'resolved');
    store.setSetting('example', { enabled:true });
    assert.deepEqual(store.getSetting('example'), { enabled:true });
    store.setIpGeo('8.8.8.8', { country:'美国' });
    assert.equal(store.getIpGeo('8.8.8.8', 30).country, '美国');
  } finally { fs.rmSync(directory, { recursive:true, force:true }); }
});
