import test from 'node:test';
import assert from 'node:assert/strict';
import { PPOQueryDriver } from '../src/query-driver.js';

function error(code) {
  return Object.assign(new Error(code), { code });
}

function mockedDriver(outcomes) {
  const driver = new PPOQueryDriver({ maxRetries: 1, dataDir: '/tmp' }, null);
  let calls = 0;
  let resets = 0;
  driver.ensureBrowser = async () => {};
  driver.resetOfficialSession = async () => { resets += 1; };
  driver.captureDiagnostics = async () => ({ reason: 'test' });
  driver.runAttempt = async (_input, _report, attempt) => {
    const outcome = outcomes[calls++];
    if (outcome instanceof Error) throw outcome;
    return { totalFine: '0', violationCount: 0, attempt };
  };
  return { driver, calls: () => calls, resets: () => resets };
}

const passport = { ownerType: 'passport', documentNumber: 'EA1234567' };

test('rebuilds an invalid PPO session only once and then succeeds', async () => {
  const fixture = mockedDriver([error('OFFICIAL_AUTH_ERROR'), {}]);
  const result = await fixture.driver.execute(passport, () => {});
  assert.equal(fixture.calls(), 2);
  assert.equal(fixture.resets(), 1);
  assert.deepEqual(result.retryKinds, ['official_session']);
});

test('bounds combined session and passport recovery to three submissions', async () => {
  const fixture = mockedDriver([
    error('OFFICIAL_AUTH_ERROR'),
    error('IDENTITY_MISMATCH'),
    error('IDENTITY_MISMATCH')
  ]);
  await assert.rejects(() => fixture.driver.execute(passport, () => {}), candidate => {
    assert.equal(candidate.code, 'IDENTITY_MISMATCH');
    assert.equal(candidate.attempt, 3);
    assert.deepEqual(candidate.retryKinds, ['official_session', 'passport_format']);
    return true;
  });
  assert.equal(fixture.calls(), 3);
  assert.equal(fixture.resets(), 1);
});

test('does not turn repeated PPO authentication failures into passport retries', async () => {
  const fixture = mockedDriver([error('OFFICIAL_AUTH_ERROR'), error('OFFICIAL_AUTH_ERROR')]);
  await assert.rejects(() => fixture.driver.execute(passport, () => {}), candidate => {
    assert.equal(candidate.attempt, 2);
    assert.deepEqual(candidate.retryKinds, ['official_session']);
    return true;
  });
  assert.equal(fixture.calls(), 2);
  assert.equal(fixture.resets(), 1);
});
