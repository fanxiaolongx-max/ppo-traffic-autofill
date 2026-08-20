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
