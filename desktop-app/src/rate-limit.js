export class RateLimiter {
  constructor(config) {
    this.config = config;
    this.minute = new Map();
    this.attempts = new Map();
    this.day = new Map();
    this.devices = new Map();
    this.feedbackHour = new Map();
    this.feedbackDay = new Map();
    this.lastPruneAt = 0;
  }

  checkFeedback({ ip, deviceId }) {
    const now = Date.now();
    this.prune(now);
    const identity = `${ip}:${deviceId || 'unknown'}`;
    const hourKey = `${identity}:${Math.floor(now / 3_600_000)}`;
    const dayKey = `${identity}:${new Date(now).toISOString().slice(0, 10)}`;
    const hourCount = this.feedbackHour.get(hourKey) || 0;
    const dayCount = this.feedbackDay.get(dayKey) || 0;
    if (hourCount >= this.config.feedbackPerHour) {
      return { allowed: false, code: 'FEEDBACK_RATE_HOUR', retryAfterMs: 3_600_000 - (now % 3_600_000) };
    }
    if (dayCount >= this.config.feedbackPerDay) {
      return { allowed: false, code: 'FEEDBACK_RATE_DAY', retryAfterMs: 86_400_000 - (now % 86_400_000) };
    }
    this.feedbackHour.set(hourKey, hourCount + 1);
    this.feedbackDay.set(dayKey, dayCount + 1);
    return { allowed: true };
  }

  checkAttempt({ ip, privileged = false }) {
    if (privileged) return { allowed: true };
    const now = Date.now();
    this.prune(now);
    const key = `${ip}:${Math.floor(now / 60_000)}`;
    const count = this.attempts.get(key) || 0;
    if (count >= this.config.ipSubmissionPerMinute) {
      return { allowed: false, code: 'RATE_SUBMISSIONS', retryAfterMs: 60_000 - (now % 60_000) };
    }
    this.attempts.set(key, count + 1);
    return { allowed: true };
  }

  check({ ip, deviceId, privileged = false }) {
    if (privileged) return { allowed: true };
    const now = Date.now();
    this.prune(now);
    const minuteKey = `${ip}:${Math.floor(now / 60_000)}`;
    const dayKey = `${ip}:${new Date(now).toISOString().slice(0, 10)}`;
    const minuteCount = this.minute.get(minuteKey) || 0;
    const dayCount = this.day.get(dayKey) || 0;
    const lastDevice = this.devices.get(deviceId || ip) || 0;

    if (minuteCount >= this.config.ipPerMinute) {
      return { allowed: false, code: 'RATE_MINUTE', retryAfterMs: 60_000 - (now % 60_000) };
    }
    if (dayCount >= this.config.ipPerDay) {
      return { allowed: false, code: 'RATE_DAY', retryAfterMs: 86_400_000 - (now % 86_400_000) };
    }
    if (now - lastDevice < this.config.deviceCooldownMs) {
      return { allowed: false, code: 'DEVICE_COOLDOWN', retryAfterMs: this.config.deviceCooldownMs - (now - lastDevice) };
    }

    this.minute.set(minuteKey, minuteCount + 1);
    this.day.set(dayKey, dayCount + 1);
    this.devices.set(deviceId || ip, now);
    return { allowed: true };
  }

  prune(now) {
    if (now - this.lastPruneAt < 300_000) return;
    this.lastPruneAt = now;
    const currentMinute = Math.floor(now / 60_000);
    const currentDay = new Date(now).toISOString().slice(0, 10);
    for (const key of this.minute.keys()) if (Number(key.split(':').at(-1)) < currentMinute - 2) this.minute.delete(key);
    for (const key of this.attempts.keys()) if (Number(key.split(':').at(-1)) < currentMinute - 2) this.attempts.delete(key);
    for (const key of this.day.keys()) if (!key.endsWith(`:${currentDay}`)) this.day.delete(key);
    const currentHour = Math.floor(now / 3_600_000);
    for (const key of this.feedbackHour.keys()) if (Number(key.split(':').at(-1)) < currentHour - 2) this.feedbackHour.delete(key);
    for (const key of this.feedbackDay.keys()) if (!key.includes(`:${currentDay}`)) this.feedbackDay.delete(key);
    for (const [key, value] of this.devices) if (now - value > 86_400_000) this.devices.delete(key);
  }
}

export function summarizeEventStreams(clients, { maxEventClients, maxEventClientsPerIp }, now = Date.now()) {
  const byIp = new Map();
  const deviceIds = new Set();
  for (const client of clients) {
    const ip = client.ip || 'unknown';
    const deviceId = client.deviceId || 'unknown';
    deviceIds.add(deviceId);
    const group = byIp.get(ip) || { ip, count: 0, devices: new Map(), oldestConnectedAt: now, lastActivityAt: 0 };
    group.count += 1;
    group.devices.set(deviceId, (group.devices.get(deviceId) || 0) + 1);
    group.oldestConnectedAt = Math.min(group.oldestConnectedAt, client.connectedAt || now);
    group.lastActivityAt = Math.max(group.lastActivityAt, client.lastActivityAt || client.connectedAt || now);
    byIp.set(ip, group);
  }
  return {
    total: clients.size,
    limit: maxEventClients,
    remaining: Math.max(0, maxEventClients - clients.size),
    uniqueIps: byIp.size,
    uniqueDevices: deviceIds.size,
    perIpLimit: maxEventClientsPerIp,
    byIp: [...byIp.values()].sort((a, b) => b.count - a.count || a.ip.localeCompare(b.ip)).map(group => ({
      ip: group.ip,
      count: group.count,
      limit: maxEventClientsPerIp,
      oldestConnectedAt: new Date(group.oldestConnectedAt).toISOString(),
      lastActivityAt: new Date(group.lastActivityAt).toISOString(),
      devices: [...group.devices].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([deviceId, count]) => ({ deviceId, count }))
    }))
  };
}

export function eventStreamLifetime({ eventClientMinAgeMs, eventClientMaxAgeMs }, random = Math.random) {
  const minimum = Math.max(60_000, Number(eventClientMinAgeMs) || 600_000);
  const maximum = Math.max(minimum, Number(eventClientMaxAgeMs) || 900_000);
  return minimum + Math.floor(Math.min(1, Math.max(0, random())) * (maximum - minimum));
}
