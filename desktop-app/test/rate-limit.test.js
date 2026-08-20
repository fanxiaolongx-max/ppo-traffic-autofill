import test from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../src/rate-limit.js';

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
