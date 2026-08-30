export class SmsScheduleRunner {
  constructor({ store, queue, notifier, config, logger, now = () => Date.now() }) {
    Object.assign(this, { store, queue, notifier, config, logger, now });
    this.timer = null;
    this.running = false;
    this.stopped = false;
  }

  start() {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => void this.tick(), this.config.smsSchedulePollMs);
    this.timer.unref?.();
    queueMicrotask(() => void this.tick());
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.running || this.stopped) return false;
    const sms = this.notifier.getConfig();
    if (!sms.enabled || !sms.tokenConfigured || this.queue.maintenance) return false;
    const snapshot = this.queue.snapshot();
    // Scheduled work yields to every foreground or already queued task and only
    // claims one item at a time. QueryQueue remains the sole PPO executor.
    if (snapshot.running || snapshot.queued.length) return false;

    this.running = true;
    let binding = null;
    try {
      const timestamp = this.now();
      const runAt = new Date(timestamp).toISOString();
      binding = this.store.claimDueSmsSchedule(runAt, new Date(timestamp + this.config.smsScheduleLeaseMs).toISOString());
      if (!binding) return false;
      const sourceQuery = this.store.getQuery(binding.queryId);
      if (!sourceQuery?.request) throw Object.assign(new Error('周期查询的原始查询不存在'), { code: 'SMS_SCHEDULE_SOURCE_MISSING' });
      const result = this.queue.enqueue(sourceQuery.request, {
        requestId: `schedule:${binding.id}:${timestamp}`,
        source: 'scheduled_sms', sourceIp: binding.sourceIp, deviceId: binding.deviceId,
        userAgent: 'PPO SMS periodic scheduler'
      });
      const nextRunAt = new Date(timestamp + binding.intervalHours * 3_600_000).toISOString();
      this.store.completeSmsSchedule(binding.id, { queryId: result.record.id, nextRunAt, runAt });
      this.logger.info('sms_schedule_enqueued', {
        bindingId: binding.id, queryId: result.record.id, traceId: result.record.traceId,
        intervalHours: binding.intervalHours, nextRunAt, reused: result.reused
      });
      return true;
    } catch (error) {
      if (binding) {
        const delay = Math.max(this.config.smsScheduleRetryMs, Number(error.retryAfterMs) || 0);
        this.store.deferSmsSchedule(binding.id, new Date(this.now() + delay).toISOString());
      }
      this.logger.warn('sms_schedule_deferred', { bindingId: binding?.id || null, error: { code: error.code, message: error.message } });
      return false;
    } finally {
      this.running = false;
    }
  }

  handleTerminal(record) {
    if (record?.source !== 'scheduled_sms' || record.status !== 'failed') return false;
    const binding = this.store.smsBindingByLastQueryId(record.id);
    if (!binding) return false;
    const nextRunAt = new Date(this.now() + this.config.smsScheduleRetryMs).toISOString();
    this.store.deferSmsSchedule(binding.id, nextRunAt);
    this.logger.warn('sms_schedule_query_failed', {
      bindingId: binding.id, queryId: record.id, traceId: record.traceId,
      code: record.error?.code || null, nextRunAt
    });
    return true;
  }
}
