import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createPackage } from '@electron/asar';

const execFileAsync = promisify(execFile);
const appRoot = fileURLToPath(new URL('..', import.meta.url));

async function electronExecutable() {
  if (process.env.PPO_TEST_ELECTRON_PATH) return process.env.PPO_TEST_ELECTRON_PATH;
  try {
    // Importing newer electron packages can download a missing runtime. Keep
    // ordinary test runs offline by checking the installed binary first.
    const require = createRequire(import.meta.url);
    const packageRoot = path.dirname(require.resolve('electron/package.json'));
    const relativePath = fs.readFileSync(path.join(packageRoot, 'path.txt'), 'utf8').trim();
    if (!relativePath || !fs.existsSync(path.join(packageRoot, 'dist', relativePath))) return '';
    const { default: executable } = await import('electron');
    return typeof executable === 'string' && fs.existsSync(executable) ? executable : '';
  } catch {
    return '';
  }
}

// Run inside Electron's Node mode so its real ASAR filesystem hooks are tested,
// without opening windows or sharing the installed app's service/data directory.
const runner = String.raw`
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  assert.ok(process.versions.electron, 'Regression requires the Electron ASAR implementation');
  assert.equal(typeof process._getOrCreateArchive, 'function');
  const archivePath = process.env.PPO_TEST_APP_ARCHIVE;
  const archive = process._getOrCreateArchive(archivePath);
  assert.ok(archive, 'Fixture must be a readable packed ASAR');
  const routes = [
    ['/', 'index.html'],
    ['/admin', 'admin.html'],
    ['/admin/', 'admin.html'],
    ['/app.js', 'app.js'],
    ['/styles.css', 'styles.css']
  ];
  const expected = new Map(routes.map(([route, file]) => [
    route, fs.readFileSync(path.join(archivePath, 'public', file))
  ]));
  globalThis.__PPO_CORE_SHELL__ = true;
  const core = await import(pathToFileURL(path.join(archivePath, 'src', 'server.js')).href);
  try {
    const { port } = await core.serverReady;
    const baseUrl = 'http://127.0.0.1:' + port;
    async function get(route) {
      const response = await fetch(baseUrl + route, { signal: AbortSignal.timeout(3000) });
      const body = Buffer.from(await response.arrayBuffer());
      return { response, body };
    }
    async function checkPages() {
      for (const [route] of routes) {
        const { response, body } = await get(route);
        assert.equal(response.status, 200, route + ' must stay available');
        assert.deepEqual(body, expected.get(route), route + ' must return the complete packed asset');
        assert.match(response.headers.get('cache-control'), /no-store/);
      }
    }

    await checkPages();
    const removedCopies = [];
    for (const file of ['index.html', 'admin.html', 'app.js']) {
      // Seed the exact process-local cache, even when the fixed route no longer
      // extracts files. Remove only files returned by this child archive.
      const extracted = archive.copyFileOut('public/' + file);
      assert.ok(extracted && fs.existsSync(extracted), 'ASAR extraction must exist for ' + file);
      assert.deepEqual(fs.readFileSync(extracted), fs.readFileSync(path.join(archivePath, 'public', file)));
      fs.unlinkSync(extracted);
      removedCopies.push(extracted);
    }
    await checkPages();
    await checkPages();
    for (const file of removedCopies) assert.equal(fs.existsSync(file), false, 'Static reads must not need a replacement temp copy');

    const missing = await get('/missing-asset.js');
    assert.equal(missing.response.status, 404);
    const health = await get('/api/v1/health');
    assert.equal(health.response.status, 200);
    assert.equal(JSON.parse(health.body).ok, true);
    console.log('ASAR_STATIC_REGRESSION_OK');
  } finally {
    await core.shutdownServer('asar_static_regression');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
`;

test('serves packed pages after Electron cached temporary copies disappear', { timeout: 30_000 }, async t => {
  const executable = await electronExecutable();
  if (!executable) {
    t.skip('Install the Electron runtime or set PPO_TEST_ELECTRON_PATH to run the packaged ASAR regression');
    return;
  }
  // ESM resolves /var to /private/var on macOS. Use that same canonical path
  // when poisoning the archive cache so it targets the server's archive.
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-static-asar-')));
  try {
    const fixture = path.join(directory, 'app');
    fs.mkdirSync(fixture);
    for (const name of ['src', 'public', 'core-version.json', 'package.json']) {
      fs.cpSync(path.join(appRoot, name), path.join(fixture, name), { recursive: true });
    }
    const archive = path.join(directory, 'app.asar');
    await createPackage(fixture, archive);
    const { stdout } = await execFileAsync(executable, ['--eval', runner], {
      timeout: 20_000,
      killSignal: 'SIGKILL',
      maxBuffer: 512 * 1024,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PPO_TEST_APP_ARCHIVE: archive,
        PPO_DATA_DIR: path.join(directory, 'data'),
        PPO_LOG_DIR: path.join(directory, 'logs'),
        PPO_HOST: '127.0.0.1',
        PPO_PORT: '0',
        PPO_PORT_AUTO_INCREMENT: 'false',
        PPO_IP_GEO_ENABLED: 'false',
        PPO_ADMIN_PASSWORD: 'asar-regression-password',
        SMS_API_TOKEN: ''
      }
    });
    assert.match(stdout, /ASAR_STATIC_REGRESSION_OK/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
