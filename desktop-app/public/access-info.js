export function accessType(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || /^127\./.test(host)) return '本机访问';
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host.endsWith('.local')) return '局域网访问';
  return '公网域名';
}

export function buildAccessInfo(locationLike, servicePortValue = 0) {
  const origin = String(locationLike.origin || '');
  const accessPort = Number(locationLike.port || (locationLike.protocol === 'https:' ? 443 : 80));
  const servicePort = Number(servicePortValue || 0);
  const kind = accessType(locationLike.hostname);
  const portText = kind === '公网域名'
    ? `访问端口 ${accessPort}`
    : (servicePort && servicePort !== accessPort
      ? `访问端口 ${accessPort} · 服务端口 ${servicePort}`
      : `端口 ${servicePort || accessPort}`);
  return {
    origin,
    kind,
    accessPort,
    servicePort,
    portText
  };
}
