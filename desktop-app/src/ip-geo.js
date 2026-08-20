import { isIP } from 'node:net';

function privateAddress(ip) {
  if (!isIP(ip)) return 'unknown';
  if (ip === '127.0.0.1' || ip === '::1') return 'loopback';
  if (ip.includes(':')) {
    const lower = ip.toLowerCase();
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return 'link_local';
    if (lower.startsWith('fc') || lower.startsWith('fd')) return 'private';
    return '';
  }
  const parts = ip.split('.').map(Number);
  if (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168)) return 'private';
  if (parts[0] === 169 && parts[1] === 254) return 'link_local';
  return '';
}

export class IpGeoResolver {
  constructor({ store, config, logger }) {
    this.store = store;
    this.config = config;
    this.logger = logger;
    this.pending = new Map();
  }

  async lookup(ip) {
    const scope = privateAddress(ip);
    if (scope) return { scope, provider: 'local', country: scope === 'loopback' ? '本机' : scope === 'unknown' ? '未知' : '局域网' };
    if (!this.config.ipGeoEnabled) return { scope: 'public', provider: 'disabled' };
    const cached = this.store.getIpGeo(ip, this.config.ipGeoCacheDays);
    if (cached) return cached;
    if (this.pending.has(ip)) return this.pending.get(ip);
    const task = this.fetch(ip).finally(() => this.pending.delete(ip));
    this.pending.set(ip, task);
    return task;
  }

  async fetch(ip) {
    try {
      const endpoint = this.config.ipGeoEndpoint.replace(/\/$/, '');
      const url = `${endpoint}/${encodeURIComponent(ip)}?fields=success,message,country,country_code,region,city,connection.isp,timezone.id&lang=zh-CN`;
      const response = await fetch(url, { signal: AbortSignal.timeout(this.config.ipGeoTimeoutMs), headers: { accept: 'application/json' } });
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.message || `HTTP ${response.status}`);
      const result = {
        scope: 'public', provider: 'ipwho.is', country: data.country || '', countryCode: data.country_code || '',
        region: data.region || '', city: data.city || '', isp: data.connection?.isp || '', timezone: data.timezone?.id || '',
        resolvedAt: new Date().toISOString()
      };
      this.store.setIpGeo(ip, result);
      return result;
    } catch (error) {
      this.logger.warn('ip_geo_lookup_failed', { sourceIp: ip, error: { name: error.name, message: error.message } });
      return { scope: 'public', provider: 'ipwho.is', unavailable: true };
    }
  }
}
