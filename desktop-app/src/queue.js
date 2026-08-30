import crypto from 'node:crypto';
import { isInfrastructureError } from './official-error.js';

const ACTIVE = new Set(['queued', 'running']);

function maskDocument(value) {
  const text = String(value || '');
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 2)}${'*'.repeat(Math.min(8, text.length - 4))}${text.slice(-2)}`;
}

function auditContext(value, extra = {}) {
  const request = value?.request || value || {};
  return {
    queryId: value?.id || extra.queryId || null,
    traceId: value?.traceId || extra.traceId || null,
    source: value?.source || extra.source || null,
    plate: `${[request.letter1, request.letter2, request.letter3].filter(Boolean).join(' ')} ${request.plateNumber || ''}`.trim(),
    documentMasked: maskDocument(request.documentNumber),
    ownerType: request.ownerType || null
  };
}

export class QueryQueue {
  constructor({ store, driver, config, logger, broadcast, onTerminal = null }) {
    Object.assign(this, { store, driver, config, logger, broadcast, onTerminal });
    this.pending = [];
    this.running = false;
    this.currentId = null;
    this.maintenance = false;
    this.failureStreak = 0;
    this.circuitOpenUntil = 0;
    for (const record of store.list(500, ['queued']).reverse()) this.pending.push(record.id);
    queueMicrotask(() => this.drain());
  }

  fingerprint(request) {
    return crypto.createHash('sha256').update(JSON.stringify({
      letter1: request.letter1, letter2: request.letter2, letter3: request.letter3,
      plateNumber: request.plateNumber, ownerType: request.ownerType,
      documentNumber: request.documentNumber, country: request.country,
      foreignType: request.foreignType
    })).digest('hex');
  }

  enqueue(request, meta) {
    if (this.maintenance) {
      throw Object.assign(new Error('服务正在平滑更新，请稍后再试'), {
        code: 'CORE_MAINTENANCE', statusCode: 503, retryAfterMs: 5_000
      });
    }
    if (!meta.force && meta.requestId) {
      const existing = this.store.getByRequestId(meta.requestId, meta.deviceId);
      if (existing) {
        this.logger.info('query_dedupe_reused', { ...auditContext(existing), reason: 'request_id' });
        return { record: existing, reused: true };
      }
    }
    const fingerprint = this.fingerprint(request);
    const since = new Date(Date.now() - this.config.dedupeWindowMs).toISOString();
    const duplicate = meta.force ? null : this.store.findRecentFingerprint(fingerprint, since, meta.deviceId);
    if (duplicate) {
      this.logger.info('query_dedupe_reused', { ...auditContext(duplicate), reason: 'fingerprint' });
      return { record: duplicate, reused: true };
    }
    if (Date.now() < this.circuitOpenUntil) {
      const retryAfterMs = Math.max(1_000, this.circuitOpenUntil - Date.now());
      this.logger.warn('query_rejected_circuit_open', { ...auditContext(request, meta), sourceIp: meta.sourceIp, retryAfterMs });
      this.store.addServiceEvent?.('queue', 'degraded', 'CIRCUIT_REJECTED', '熔断期间拒绝了新的查询请求', { retryAfterMs }, { force: true });
      throw Object.assign(new Error('PPO 官网连续异常，查询已暂时停止接收，请稍后再试'), {
        code: 'CIRCUIT_OPEN', statusCode: 503, retryAfterMs
      });
    }
    if (this.pending.length + (this.running ? 1 : 0) >= this.config.queueMax) {
      const retryAfterMs = this.config.estimatedTaskMs;
      this.logger.warn('query_rejected_queue_full', { ...auditContext(request, meta), sourceIp: meta.sourceIp, queueMax: this.config.queueMax, retryAfterMs });
      this.store.addServiceEvent?.('queue', 'degraded', 'QUEUE_FULL', '查询队列已达到容量上限', { queueMax: this.config.queueMax }, { force: true });
      throw Object.assign(new Error('当前查询队列已满，请稍后再试'), { code: 'QUEUE_FULL', statusCode: 503, retryAfterMs });
    }

    const id = `qry_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const traceId = `tr_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const record = this.store.createQuery({
      id, traceId, fingerprint, requestId: meta.requestId || null,
      status: 'queued', progress: 0, step: 'queued', request,
      source: meta.source, sourceIp: meta.sourceIp, deviceId: meta.deviceId,
      userAgent: meta.userAgent, createdAt: now
    });
    this.pending.push(id);
    this.logger.info('query_queued', { ...auditContext(record), sourceIp: meta.sourceIp, request });
    this.emit(record);
    this.drain();
    return { record, reused: false };
  }

  async drain() {
    if (this.running || !this.pending.length) return;
    if (Date.now() < this.circuitOpenUntil) {
      setTimeout(() => this.drain(), Math.min(30_000, this.circuitOpenUntil - Date.now())).unref();
      return;
    }
    this.running = true;
    let id = null;
    let record = null;
    while (this.pending.length && !record) {
      id = this.pending.shift();
      const candidate = this.store.getQuery(id);
      if (!candidate || candidate.status !== 'queued') continue;
      const queuedForMs = Date.now() - new Date(candidate.queuedAt || candidate.createdAt).getTime();
      if (queuedForMs > this.config.queueTtlMs) {
        const expired = this.store.updateQuery(id, {
          status: 'failed', step: 'queue_expired', detail: '等待时间超过队列上限，请重新提交', progress: 100,
          error: { code: 'QUEUE_EXPIRED', message: '排队等待时间过长，任务已安全终止，请重新提交' },
          finishedAt: new Date().toISOString()
        });
        this.logger.warn('query_queue_expired', { ...auditContext(expired), queuedForMs });
        this.store.addServiceEvent?.('queue', 'degraded', 'QUEUE_EXPIRED', '排队任务等待超时后已安全终止', { queuedForMs }, { force: true });
        this.emit(expired);
        this.notifyTerminal(expired);
        continue;
      }
      record = candidate;
    }
    if (!record) {
      this.running = false;
      return;
    }
    this.currentId = id;
    const startedAt = new Date().toISOString();
    record = this.store.updateQuery(id, { status: 'running', step: 'starting_browser', progress: 5, startedAt });
    this.logger.info('query_started', auditContext(record));
    this.emit(record);
    try {
      let lastLoggedStep = '';
      const result = await this.driver.execute(record.request, update => {
        record = this.store.updateQuery(id, {
          step: update.step,
          progress: update.progress,
          attempt: update.attempt ?? record.attempt,
          detail: update.detail ?? null,
          retryFormat: update.retryFormat,
          diagnostic: update.diagnostic
        });
        if (update.step === 'retrying_passport_format') {
          this.logger.info('passport_retry_started', {
            ...auditContext(record), attempt: update.attempt,
            retryFormat: update.retryFormat || 'alternate'
          });
        } else if (update.step === 'retrying_official_session') {
          this.logger.warn('official_session_recovery_started', {
            ...auditContext(record), attempt: update.attempt,
            detail: update.detail || null
          });
        } else if (update.step !== lastLoggedStep) {
          lastLoggedStep = update.step;
          this.logger.info('query_progress', {
            ...auditContext(record), step: update.step, progress: update.progress,
            attempt: update.attempt || record.attempt || 1,
            detail: update.detail || null,
            diagnostic: update.diagnostic || null
          });
        }
        this.emit(record);
      });
      const safeResult = { ...result };
      delete safeResult.rawText;
      record = this.store.updateQuery(id, {
        status: 'success', step: 'completed', progress: 100, result,
        finishedAt: new Date().toISOString()
      });
      this.failureStreak = 0;
      this.logger.info('query_completed', { ...auditContext(record), result: safeResult });
      this.store.addServiceEvent?.('official', 'operational', 'QUERY_SUCCESS', '最近一次 PPO 官网查询成功', { traceId: record.traceId });
      if (Number(result.attempt) > 1) {
        if (result.retryKinds?.includes('official_session')) {
          this.logger.info('official_session_recovery_finished', { ...auditContext(record), attempt: result.attempt, outcome: 'success' });
        }
        if (result.retryKinds?.includes('passport_format')) {
          this.logger.info('passport_retry_finished', { ...auditContext(record), attempt: result.attempt, outcome: 'success' });
        }
      }
      this.emit(record);
      this.notifyTerminal(record);
    } catch (error) {
      const errorInfo = {
        code: error.code || 'QUERY_FAILED', message: error.message,
        officialMessage: error.officialMessage || null,
        attempt: error.attempt || record.attempt || 1,
        retryKinds: error.retryKinds || [],
        diagnostic: error.diagnostic || null,
        stack: error.stack
      };
      record = this.store.updateQuery(id, {
        status: 'failed', step: 'failed', progress: 100, error: errorInfo,
        finishedAt: new Date().toISOString()
      });
      this.logger.error('query_failed', { ...auditContext(record), attempt: errorInfo.attempt, error: errorInfo });
      if (Number(errorInfo.attempt) > 1) {
        if (errorInfo.retryKinds.includes('official_session')) {
          this.logger.warn('official_session_recovery_finished', { ...auditContext(record), attempt: errorInfo.attempt, outcome: 'failed', code: errorInfo.code });
        }
        if (errorInfo.retryKinds.includes('passport_format')) {
          this.logger.warn('passport_retry_finished', { ...auditContext(record), attempt: errorInfo.attempt, outcome: 'failed', code: errorInfo.code });
        }
      }
      const infrastructureFailure = isInfrastructureError(errorInfo.code);
      if (infrastructureFailure) this.failureStreak += 1;
      if (infrastructureFailure && this.failureStreak >= this.config.circuitFailures) {
        this.circuitOpenUntil = Date.now() + this.config.circuitCooldownMs;
        this.logger.warn('circuit_opened', { ...auditContext(record), failureStreak: this.failureStreak, until: new Date(this.circuitOpenUntil).toISOString() });
        this.store.addServiceEvent?.('official', 'outage', 'CIRCUIT_OPEN', 'PPO 官网连续异常，已触发保护性熔断', { failureStreak: this.failureStreak });
      } else if (infrastructureFailure) {
        this.store.addServiceEvent?.('official', 'degraded', errorInfo.code, errorInfo.message, { failureStreak: this.failureStreak });
      } else {
        this.store.addServiceEvent?.('official', 'operational', 'OFFICIAL_RESPONDED', 'PPO 官网已正常响应查询请求', {});
      }
      this.emit(record);
      this.notifyTerminal(record);
    } finally {
      this.running = false;
      this.currentId = null;
      setImmediate(() => this.drain());
    }
  }

  cancel(id) {
    const record = this.store.getQuery(id);
    if (!record || !ACTIVE.has(record.status)) return null;
    if (record.status === 'running') {
      throw Object.assign(new Error('当前版本仅支持取消尚未执行的任务'), { code: 'ALREADY_RUNNING', statusCode: 409 });
    }
    this.pending = this.pending.filter(item => item !== id);
    const updated = this.store.updateQuery(id, { status: 'cancelled', step: 'cancelled', progress: 100, finishedAt: new Date().toISOString() });
    this.logger.info('query_cancelled', auditContext(updated));
    this.emit(updated);
    return updated;
  }

  snapshot() {
    return {
      running: this.currentId ? this.store.getQuery(this.currentId) : null,
      queued: this.pending.map(id => this.store.getQuery(id)).filter(Boolean),
      circuit: {
        open: Date.now() < this.circuitOpenUntil,
        openUntil: this.circuitOpenUntil ? new Date(this.circuitOpenUntil).toISOString() : null,
        failureStreak: this.failureStreak
      }
    };
  }

  beginMaintenance() {
    this.maintenance = true;
    this.store.addServiceEvent?.('server', 'degraded', 'CORE_MAINTENANCE', '正在排空队列并切换查询内核', {}, { force: true });
    this.broadcast(null);
  }

  endMaintenance() {
    this.maintenance = false;
    this.broadcast(null);
    this.drain();
  }

  async waitForIdle(timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    while (this.running || this.currentId || this.pending.length) {
      if (Date.now() >= deadline) throw new Error('等待查询队列排空超时');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  publicSnapshot(deviceId = '') {
    const now = Date.now();
    const raw = this.snapshot();
    const ownRunning = raw.running?.deviceId === deviceId ? publicRecord(raw.running, true) : null;
    const ownQueued = raw.queued.flatMap((record, index) => record.deviceId === deviceId ? [{
      ...publicRecord(record, true),
      queuePosition: index + (raw.running ? 2 : 1),
      estimatedWaitMs: (index + (raw.running ? 1 : 0)) * this.config.estimatedTaskMs
    }] : []);
    const circuitOpen = now < this.circuitOpenUntil;
    return {
      runningCount: raw.running ? 1 : 0,
      queuedCount: raw.queued.length,
      capacity: this.config.queueMax,
      accepting: !this.maintenance && !circuitOpen && raw.queued.length + (raw.running ? 1 : 0) < this.config.queueMax,
      maintenance: this.maintenance,
      running: ownRunning,
      queued: ownQueued,
      circuit: {
        open: circuitOpen,
        retryAfterMs: circuitOpen ? Math.max(0, this.circuitOpenUntil - now) : 0,
        openUntil: circuitOpen ? new Date(this.circuitOpenUntil).toISOString() : null
      }
    };
  }

  emit(record) {
    this.broadcast(record);
  }

  notifyTerminal(record) {
    if (!this.onTerminal) return;
    try { this.onTerminal(record); }
    catch (error) { this.logger.error('terminal_hook_failed', { queryId: record?.id, traceId: record?.traceId, error: { message: error.message, stack: error.stack } }); }
  }
}

export function publicRecord(record, includeRequest = false) {
  if (!record) return null;
  const value = { ...record };
  delete value.fingerprint;
  delete value.sourceIp;
  delete value.deviceId;
  delete value.userAgent;
  delete value.geo;
  if (!includeRequest) delete value.request;
  else if (value.request) {
    const documentNumber = String(value.request.documentNumber || '');
    value.request = {
      ...value.request,
      documentNumber: documentNumber.length > 4
        ? `${documentNumber.slice(0, 2)}${'*'.repeat(Math.min(8, documentNumber.length - 4))}${documentNumber.slice(-2)}`
        : '*'.repeat(documentNumber.length)
    };
  }
  const sourceDiagnostic = value.result?.diagnostic || value.error?.diagnostic;
  value.diagnostics = {
    before: Boolean(sourceDiagnostic?.preSubmitScreenshotPath),
    after: Boolean(sourceDiagnostic?.screenshotPath)
  };
  if (value.result?.rawText || value.result?.diagnostic) {
    value.result = { ...value.result };
    delete value.result.rawText;
    if (value.result.diagnostic) {
      value.result.diagnostic = {
        reason: value.result.diagnostic.reason,
        url: value.result.diagnostic.url,
        title: value.result.diagnostic.title,
        readyState: value.result.diagnostic.readyState,
        bodyLength: value.result.diagnostic.bodyLength,
        dialogCount: value.result.diagnostic.dialogCount
      };
    }
  }
  if (value.error) {
    const diagnostic = value.error.diagnostic ? {
      reason: value.error.diagnostic.reason,
      url: value.error.diagnostic.url,
      title: value.error.diagnostic.title,
      readyState: value.error.diagnostic.readyState,
      bodyLength: value.error.diagnostic.bodyLength,
      dialogCount: value.error.diagnostic.dialogCount
    } : null;
    value.error = { ...value.error, diagnostic };
    delete value.error.stack;
  }
  return value;
}

export function publicEvent(event) {
  const details = event?.details || {};
  return {
    id: event.id,
    event: event.event,
    status: event.status,
    step: event.step,
    progress: event.progress,
    createdAt: event.createdAt,
    detail: typeof details.detail === 'string' ? details.detail.slice(0, 300) : null,
    attempt: Number.isFinite(details.attempt) ? details.attempt : null,
    retryFormat: ['without_prefix', 'raw', 'alternate'].includes(details.retryFormat) ? details.retryFormat : null
  };
}
