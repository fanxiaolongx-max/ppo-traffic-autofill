import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuditLogger } from '../src/logger.js';

test('writes one physical JSON line with UTC and local timestamps and supports field search', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-logger-test-'));
  const originalLog = console.log;
  console.log = () => {};
  try {
    const logger = new AuditLogger(directory);
    logger.info('query_completed', {
      traceId: 'tr_a4a34049-c8af-492f-9cd3-1f08ee331a42',
      plate: 'أ ف س 3413',
      documentMasked: 'EC****02',
      result: { totalFine: '1000 جنيه', violationCount: 3 }
    });
    const file = fs.readdirSync(directory).find(name => name.endsWith('.jsonl'));
    const raw = fs.readFileSync(path.join(directory, file), 'utf8');
    assert.equal(raw.trim().split('\n').length, 1);
    const entry = JSON.parse(raw);
    assert.match(entry.timestamp, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    assert.match(entry.localTimestamp, /^\d{4}-\d{2}-\d{2}T.*[+-]\d{2}:\d{2}$/);
    assert.equal(logger.recent({ query: 'أ ف س 3413' }).length, 1);
    assert.equal(logger.recent({ query: 'EC••••02' }).length, 1);
    assert.equal(logger.recent({ query: 'tr_a4a34049', level: 'info', event: 'completed' }).length, 1);
    assert.equal(logger.recent({ query: 'not-found' }).length, 0);
  } finally {
    console.log = originalLog;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('paginates matching structured logs with an opaque cursor', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-logger-page-test-'));
  const originalLog = console.log;
  console.log = () => {};
  try {
    const logger = new AuditLogger(directory);
    for (let index = 0; index < 7; index += 1) logger.info('query_completed', { traceId: `tr_${index}`, plate: `plate ${index}` });
    const first = logger.recentPage({ event: 'query_completed', limit: 3 });
    const second = logger.recentPage({ event: 'query_completed', limit: 3, cursor: first.nextCursor });
    assert.equal(first.items.length, 3);
    assert.equal(first.hasMore, true);
    assert.equal(second.items.length, 3);
    assert.equal(new Set([...first.items, ...second.items].map(item => item.traceId)).size, 6);
  } finally {
    console.log = originalLog;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
