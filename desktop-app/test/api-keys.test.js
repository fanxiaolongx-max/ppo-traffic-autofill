import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../src/db.js';
import { createSkillPackage, renderSkillMd, renderCliScript, renderReadme } from '../src/skill-packager.js';

test('creates, lists, verifies, and deletes dynamic API keys in store', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-apikey-test-'));
  try {
    const store = new Store(directory);
    assert.deepEqual(store.listApiKeys(), []);

    const created = store.createApiKey({ name: 'Agent Project Test' });
    assert.ok(created.id.startsWith('apk_'));
    assert.equal(created.name, 'Agent Project Test');
    assert.ok(created.key.startsWith('ppo_live_'));
    assert.match(created.preview, /^ppo_live_.+••••.+$/);
    assert.equal(created.isActive, true);

    const list = store.listApiKeys();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, created.id);
    assert.equal(list[0].name, 'Agent Project Test');
    assert.equal(list[0].lastUsedAt, null);
    assert.equal(list[0].key, undefined); // raw key should not leak in list view

    const fetched = store.getApiKey(created.id);
    assert.ok(fetched);
    assert.equal(fetched.key, created.key);

    // Verification check
    assert.equal(store.verifyApiKey('invalid-key'), false);
    assert.equal(store.verifyApiKey(created.key), true);

    const afterVerify = store.listApiKeys();
    assert.ok(afterVerify[0].lastUsedAt, 'lastUsedAt must be updated after successful verification');

    // Deletion
    const deleted = store.deleteApiKey(created.id);
    assert.equal(deleted, true);
    assert.deepEqual(store.listApiKeys(), []);
    assert.equal(store.verifyApiKey(created.key), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('generates valid Skill package with injected configuration and pure zip format', () => {
  const baseUrl = 'http://192.168.1.100:17654';
  const apiKey = 'ppo_live_test1234567890abcdef';

  const skillMd = renderSkillMd({ baseUrl, apiKey });
  assert.match(skillMd, /http:\/\/192\.168\.1\.100:17654/);
  assert.match(skillMd, /ppo_live_test1234567890abcdef/);

  const cliPy = renderCliScript({ baseUrl, apiKey });
  assert.match(cliPy, /http:\/\/192\.168\.1\.100:17654/);
  assert.match(cliPy, /ppo_live_test1234567890abcdef/);

  const readme = renderReadme({ baseUrl, apiKey });
  assert.match(readme, /http:\/\/192\.168\.1\.100:17654/);
  assert.match(readme, /ppo_live_test1234567890abcdef/);

  const zipBuffer = createSkillPackage({ baseUrl, apiKey });
  assert.ok(Buffer.isBuffer(zipBuffer));
  assert.ok(zipBuffer.length > 500);

  // Check zip magic bytes (0x50, 0x4b, 0x03, 0x04)
  assert.equal(zipBuffer[0], 0x50);
  assert.equal(zipBuffer[1], 0x4b);
  assert.equal(zipBuffer[2], 0x03);
  assert.equal(zipBuffer[3], 0x04);
});

test('cli script inside skill package executes correctly under python3', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-cli-test-'));
  const zipFile = path.join(directory, 'skill.zip');
  try {
    const zipBuffer = createSkillPackage({ baseUrl: 'http://127.0.0.1:17654', apiKey: 'ppo_live_test_cli' });
    fs.writeFileSync(zipFile, zipBuffer);

    execFileSync('unzip', ['-q', zipFile, '-d', directory]);
    const cliPath = path.join(directory, 'ppo-traffic', 'scripts', 'ppo_cli.py');
    assert.ok(fs.existsSync(cliPath), 'ppo_cli.py must be extracted');

    const helpOut = execFileSync('python3', [cliPath, '--help'], { encoding: 'utf8' });
    assert.match(helpOut, /query/);
    assert.match(helpOut, /status/);
    assert.match(helpOut, /history/);

    const queryHelp = execFileSync('python3', [cliPath, 'query', '--help'], { encoding: 'utf8' });
    assert.match(queryHelp, /--letters/);
    assert.match(queryHelp, /--number/);
    assert.match(queryHelp, /--passport/);

    // Test argument rejection when document is missing
    let failed = false;
    try {
      execFileSync('python3', [cliPath, 'query', '--letters', 'أ ف س', '--number', '3413'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      failed = true;
      assert.equal(err.status, 2);
      assert.match(err.stderr.toString(), /passport/);
    }
    assert.equal(failed, true, 'Must exit with code 2 when required args are missing');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
