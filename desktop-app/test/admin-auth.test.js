import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminAuth } from '../src/admin-auth.js';

function fixture() {
  const settings = new Map();
  const store = { getSetting:key => settings.get(key)||null, setSetting:(key,value)=>settings.set(key,value) };
  const events = [];
  const logger = { info:(event,data)=>events.push({event,data}) };
  const config = { adminPassword:'', adminSessionHours:12, adminLoginAttempts:2, adminLoginWindowMs:60_000 };
  return { auth:new AdminAuth({ store, config, logger }), events };
}

test('hashes the admin password and creates expiring HttpOnly sessions', () => {
  const { auth } = fixture();
  auth.setPassword('123456789');
  assert.equal(auth.verifyPassword('123456789'), true);
  assert.equal(auth.verifyPassword('wrong-password'), false);
  const session = auth.createSession({ ip:'1.2.3.4', userAgent:'test' });
  const request = { headers:{ cookie:`ppo_admin_session=${session.token}` } };
  assert.equal(auth.session(request).csrfToken, session.csrfToken);
  assert.match(auth.sessionCookie(session, true), /HttpOnly; SameSite=Strict; Path=\/;.*Secure/);
});

test('accepts nine-character admin passwords and rejects shorter values', () => {
  const { auth } = fixture();
  assert.throws(() => auth.setPassword('12345678'), error => error.code === 'INVALID_ADMIN_PASSWORD');
  auth.setPassword('123456789');
  assert.equal(auth.verifyPassword('123456789'), true);
});

test('rate limits repeated admin login failures and invalidates sessions after password changes', () => {
  const { auth } = fixture();
  auth.setPassword('first-password');
  const session = auth.createSession({ ip:'1.2.3.4', userAgent:'test' });
  auth.recordFailure('5.6.7.8'); auth.recordFailure('5.6.7.8');
  assert.equal(auth.checkLoginRate('5.6.7.8').allowed, false);
  auth.setPassword('second-password');
  assert.equal(auth.session({ headers:{ cookie:`ppo_admin_session=${session.token}` } }), null);
});
