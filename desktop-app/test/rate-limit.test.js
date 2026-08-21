import test from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, eventStreamLifetime, summarizeEventStreams } from '../src/rate-limit.js';

test('limits anonymous clients and exempts valid privileged requests', () => {
  const limiter = new RateLimiter({ ipPerMinute: 2, ipPerDay: 30, deviceCooldownMs: 0, ipSubmissionPerMinute: 10 });
  assert.equal(limiter.check({ ip: '1.2.3.4', deviceId: 'a' }).allowed, true);
  assert.equal(limiter.check({ ip: '1.2.3.4', deviceId: 'b' }).allowed, true);
  assert.equal(limiter.check({ ip: '1.2.3.4', deviceId: 'c' }).code, 'RATE_MINUTE');
  assert.equal(limiter.check({ ip: '1.2.3.4', deviceId: 'c', privileged: true }).allowed, true);
});

test('enforces per-device cooldown', () => {
  const limiter = new RateLimiter({ ipPerMinute: 5, ipPerDay: 30, deviceCooldownMs: 60_000, ipSubmissionPerMinute: 10 });
  assert.equal(limiter.check({ ip: '1.2.3.4', deviceId: 'same' }).allowed, true);
  assert.equal(limiter.check({ ip: '1.2.3.5', deviceId: 'same' }).code, 'DEVICE_COOLDOWN');
});

test('prunes expired daily, minute and device entries', () => {
  const limiter = new RateLimiter({ ipPerMinute: 5, ipPerDay: 30, deviceCooldownMs: 0, ipSubmissionPerMinute: 10 });
  limiter.minute.set('1.2.3.4:1', 1);
  limiter.day.set('1.2.3.4:2020-01-01', 1);
  limiter.devices.set('old-device', 1);
  limiter.lastPruneAt = 0;
  limiter.check({ ip: '1.2.3.4', deviceId: 'current-device' });
  assert.equal(limiter.minute.has('1.2.3.4:1'), false);
  assert.equal(limiter.day.has('1.2.3.4:2020-01-01'), false);
  assert.equal(limiter.devices.has('old-device'), false);
});

test('limits malformed or rejected submissions before query validation', () => {
  const limiter = new RateLimiter({ ipPerMinute: 2, ipPerDay: 30, deviceCooldownMs: 0, ipSubmissionPerMinute: 2 });
  assert.equal(limiter.checkAttempt({ ip: '1.2.3.4' }).allowed, true);
  assert.equal(limiter.checkAttempt({ ip: '1.2.3.4' }).allowed, true);
  assert.equal(limiter.checkAttempt({ ip: '1.2.3.4' }).code, 'RATE_SUBMISSIONS');
});

test('limits feedback independently by device and IP', () => {
  const limiter = new RateLimiter({ feedbackPerHour: 2, feedbackPerDay: 5 });
  assert.equal(limiter.checkFeedback({ ip: '1.2.3.4', deviceId: 'device-a' }).allowed, true);
  assert.equal(limiter.checkFeedback({ ip: '1.2.3.4', deviceId: 'device-a' }).allowed, true);
  assert.equal(limiter.checkFeedback({ ip: '1.2.3.4', deviceId: 'device-a' }).code, 'FEEDBACK_RATE_HOUR');
  assert.equal(limiter.checkFeedback({ ip: '1.2.3.4', deviceId: 'device-b' }).allowed, true);
});

test('summarizes live event streams by IP and device without losing duplicate connections', () => {
  const now = Date.parse('2026-08-20T20:00:00.000Z');
  const clients = new Set([
    { ip:'1.2.3.4', deviceId:'device-a', connectedAt:now-60_000, lastActivityAt:now-5_000 },
    { ip:'1.2.3.4', deviceId:'device-a', connectedAt:now-30_000, lastActivityAt:now-2_000 },
    { ip:'5.6.7.8', deviceId:'device-b', connectedAt:now-10_000, lastActivityAt:now-1_000 }
  ]);
  const summary = summarizeEventStreams(clients, { maxEventClients:100, maxEventClientsPerIp:5 }, now);
  assert.equal(summary.total, 3);
  assert.equal(summary.remaining, 97);
  assert.equal(summary.uniqueIps, 2);
  assert.equal(summary.uniqueDevices, 2);
  assert.equal(summary.byIp[0].ip, '1.2.3.4');
  assert.equal(summary.byIp[0].count, 2);
  assert.deepEqual(summary.byIp[0].devices, [{ deviceId:'device-a', count:2 }]);
  assert.equal(summary.byIp[0].oldestConnectedAt, '2026-08-20T19:59:00.000Z');
  assert.equal(summary.byIp[0].lastActivityAt, '2026-08-20T19:59:58.000Z');
});

test('bounds event stream lifetime between the configured minimum and maximum', () => {
  const config = { eventClientMinAgeMs:600_000, eventClientMaxAgeMs:900_000 };
  assert.equal(eventStreamLifetime(config, () => 0), 600_000);
  assert.equal(eventStreamLifetime(config, () => 0.5), 750_000);
  assert.ok(eventStreamLifetime(config, () => 1) < 900_001);
  assert.equal(eventStreamLifetime({ eventClientMinAgeMs:900_000, eventClientMaxAgeMs:600_000 }, () => 0.5), 900_000);
});
