import { isIP } from 'node:net';

export function normalizeIp(value) {
  let candidate = String(value || '').trim().replace(/^::ffff:/, '');
  if (candidate.startsWith('[') && candidate.includes(']')) candidate = candidate.slice(1, candidate.indexOf(']'));
  return isIP(candidate) ? candidate : '';
}

export function isTrustedProxyRequest(request, config) {
  const remote = normalizeIp(request.socket?.remoteAddress);
  return Boolean(config.trustProxy && (
    remote === '127.0.0.1' || remote === '::1' || config.trustedProxies?.has(remote)
  ));
}

function firstHeaderIp(value) {
  for (const part of String(value || '').split(',')) {
    const candidate = normalizeIp(part);
    if (candidate) return candidate;
  }
  return '';
}

function forwardedHeaderIp(value) {
  for (const element of String(value || '').split(',')) {
    const match = element.match(/(?:^|;)\s*for=(?:"?)(\[[^\]]+\]|[^;",\s]+)(?:"?)/i);
    if (match) {
      const candidate = normalizeIp(match[1]);
      if (candidate) return candidate;
    }
  }
  return '';
}

export function resolveClientIp(request, config) {
  const remote = normalizeIp(request.socket?.remoteAddress) || 'unknown';
  if (!isTrustedProxyRequest(request, config)) return remote;

  return firstHeaderIp(request.headers?.['cf-connecting-ip'])
    || firstHeaderIp(request.headers?.['x-real-ip'])
    || firstHeaderIp(request.headers?.['x-forwarded-for'])
    || forwardedHeaderIp(request.headers?.forwarded)
    || remote;
}
