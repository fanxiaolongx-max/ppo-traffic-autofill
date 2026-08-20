import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, fetchLatestRelease } from '../src/release-update.js';

test('compares semantic release versions', () => {
  assert.equal(compareVersions('1.0.4', '1.0.3'), 1);
  assert.equal(compareVersions('v1.0.3', '1.0.3'), 0);
  assert.equal(compareVersions('1.0', '1.0.1'), -1);
});

test('reads the latest GitHub release without downloading an installer', async () => {
  const requests = [];
  const release = await fetchLatestRelease('owner/repository', async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ tag_name: 'v1.2.0', html_url: 'https://github.com/owner/repository/releases/tag/v1.2.0' }) };
  });
  assert.deepEqual(release, { version: '1.2.0', url: 'https://github.com/owner/repository/releases/tag/v1.2.0' });
  assert.equal(requests[0].url, 'https://api.github.com/repos/owner/repository/releases/latest');
});

test('rejects malformed release responses', async () => {
  await assert.rejects(() => fetchLatestRelease('owner/repository', async () => ({ ok: false, status: 404 })), /HTTP 404/);
  assert.throws(() => compareVersions('latest', '1.0.3'), /无法识别版本号/);
});
