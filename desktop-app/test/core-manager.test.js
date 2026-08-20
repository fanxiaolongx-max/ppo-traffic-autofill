import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { canonicalJson, CoreManager } from '../src/core-manager.js';

function signedArchive(privateKey, version = '1.0.10') {
  const files = [
    { path: 'package.json', data: Buffer.from(JSON.stringify({ version, type: 'module' })) },
    { path: 'src/server.js', data: Buffer.from('export const serverReady=Promise.resolve({port:1});') }
  ];
  const payload = {
    schemaVersion: 1, version, minShellVersion: '1.0.9', maxShellVersion: '', createdAt: '2026-08-20T00:00:00Z',
    files: files.map(file => ({ path: file.path, size: file.data.length, sha256: crypto.createHash('sha256').update(file.data).digest('hex') }))
  };
  const signature = crypto.sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64');
  const zip = new AdmZip();
  for (const file of files) zip.addFile(file.path, file.data);
  zip.addFile('core-manifest.json', Buffer.from(JSON.stringify({ ...payload, signature })));
  return zip.toBuffer();
}

test('installs only signed compatible core archives and keeps rollback state', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-core-manager-'));
  try {
    const appRoot = path.join(directory, 'app');
    const userData = path.join(directory, 'user');
    fs.mkdirSync(path.join(appRoot, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(appRoot, 'core-version.json'), JSON.stringify({ version: '1.0.9' }));
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyPath = path.join(appRoot, 'assets', 'core-update-public.pem');
    fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
    const manager = new CoreManager({ appRoot, userData, shellVersion: '1.0.9', repository: 'owner/repo', publicKeyPath });
    const installed = manager.installArchive(signedArchive(privateKey));
    assert.equal(installed.version, '1.0.10');
    manager.activate('1.0.10', '1.0.9');
    assert.equal(manager.resolveActive().version, '1.0.10');
    assert.equal(manager.rollbackDescriptor('1.0.10').version, '1.0.9');
    const tampered = signedArchive(privateKey);
    tampered[tampered.length - 30] ^= 0xff;
    assert.throws(() => manager.installArchive(tampered));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('selects the highest signed-core release instead of the first GitHub release', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-core-release-'));
  try {
    const appRoot = path.join(directory, 'app');
    fs.mkdirSync(appRoot, { recursive: true });
    fs.writeFileSync(path.join(appRoot, 'core-version.json'), JSON.stringify({ version: '1.0.9' }));
    const fetchImpl = async () => ({
      ok: true,
      async json() {
        return [
          { html_url: 'https://example.test/full', assets: [{ name: 'ppo-query-core-v1.0.9.zip', browser_download_url: 'https://example.test/1.0.9.zip' }] },
          { html_url: 'https://example.test/core', assets: [{ name: 'ppo-query-core-v1.0.11.zip', browser_download_url: 'https://example.test/1.0.11.zip' }] },
          { html_url: 'https://example.test/draft', draft: true, assets: [{ name: 'ppo-query-core-v9.0.0.zip', browser_download_url: 'https://example.test/9.0.0.zip' }] }
        ];
      }
    });
    const manager = new CoreManager({
      appRoot, userData: path.join(directory, 'user'), shellVersion: '1.0.9',
      repository: 'owner/repo', publicKeyPath: path.join(appRoot, 'unused.pem'), fetchImpl
    });
    assert.deepEqual(await manager.checkLatest(), {
      version: '1.0.11', url: 'https://example.test/1.0.11.zip', releaseUrl: 'https://example.test/core', size: null
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('treats a valid release list without core assets as no update', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-core-no-update-'));
  try {
    const appRoot = path.join(directory, 'app');
    fs.mkdirSync(appRoot, { recursive: true });
    fs.writeFileSync(path.join(appRoot, 'core-version.json'), JSON.stringify({ version: '1.0.9' }));
    const manager = new CoreManager({
      appRoot, userData: path.join(directory, 'user'), shellVersion: '1.0.9', repository: 'owner/repo',
      publicKeyPath: path.join(appRoot, 'unused.pem'),
      fetchImpl: async () => ({ ok: true, async json() { return [{ tag_name: 'v1.0.8', assets: [] }]; } })
    });
    assert.equal(await manager.checkLatest(), null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('reports a friendly error when the update endpoint returns HTML', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-core-html-response-'));
  try {
    const appRoot = path.join(directory, 'app');
    fs.mkdirSync(appRoot, { recursive: true });
    fs.writeFileSync(path.join(appRoot, 'core-version.json'), JSON.stringify({ version: '1.0.9' }));
    const manager = new CoreManager({
      appRoot, userData: path.join(directory, 'user'), shellVersion: '1.0.9', repository: 'owner/repo',
      publicKeyPath: path.join(appRoot, 'unused.pem'),
      fetchImpl: async () => ({
        ok: true, headers: { get: () => 'text/html; charset=utf-8' },
        async json() { throw new SyntaxError("Unexpected token '<'"); }
      })
    });
    await assert.rejects(() => manager.checkLatest(), /无法识别的内容.*text\/html.*网络代理/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
