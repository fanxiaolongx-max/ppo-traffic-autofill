function numericParts(version) {
  const normalized = String(version || '').trim().replace(/^v/i, '').split('-')[0];
  if (!/^\d+(?:\.\d+){0,2}$/.test(normalized)) throw new Error(`无法识别版本号：${version}`);
  const parts = normalized.split('.').map(Number);
  while (parts.length < 3) parts.push(0);
  return parts;
}

export function compareVersions(left, right) {
  const a = numericParts(left);
  const b = numericParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export async function fetchLatestRelease(repository, fetchImpl = globalThis.fetch) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('GitHub 仓库地址无效');
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'ppo-query-hub-update-checker',
      'x-github-api-version': '2022-11-28'
    },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}`);
  const release = await response.json();
  if (!release?.tag_name || !release?.html_url) throw new Error('GitHub Release 信息不完整');
  return { version: String(release.tag_name).replace(/^v/i, ''), url: release.html_url };
}
