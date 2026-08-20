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

export async function fetchLatestRelease(repository, fetchImpl = globalThis.fetch, { token = '', manifestUrl = '' } = {}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('GitHub 仓库地址无效');
  const endpoint = manifestUrl || `https://api.github.com/repos/${repository}/releases?per_page=30`;
  const response = await fetchImpl(endpoint, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'ppo-query-hub-update-checker',
      'x-github-api-version': '2022-11-28',
      ...(token ? { authorization:`Bearer ${token}` } : {})
    },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    if (response.status === 404 && !token && !manifestUrl) {
      throw new Error('GitHub 仓库为私有仓库，应用无法匿名读取 Release。请使用公开发布仓库，或配置 PPO_UPDATE_MANIFEST_URL。');
    }
    throw new Error(`更新服务器返回 HTTP ${response.status}`);
  }
  const payload = await response.json();
  const release = manifestUrl ? payload : (Array.isArray(payload) ? payload.find(item => !item.draft && !item.prerelease && /^v\d+\.\d+\.\d+$/.test(item.tag_name || '')) : payload);
  const version = manifestUrl ? release?.version : release?.tag_name;
  const url = manifestUrl ? release?.url : release?.html_url;
  if (!version || !url) throw new Error('更新版本信息不完整');
  return { version: String(version).replace(/^v/i, ''), url:String(url) };
}
