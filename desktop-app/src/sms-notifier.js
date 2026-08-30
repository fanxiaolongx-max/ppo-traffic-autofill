import crypto from 'node:crypto';

const SETTING_KEY = 'sms_notification_config';
const TOKEN_KEY = 'sms_api_token_encrypted';

export function normalizeSmsMatch(type, value) {
  const text = String(value || '').normalize('NFC').trim();
  if (type === 'document') return text.replace(/\s+/g, '').toUpperCase();
  const compact = text.replace(/[\sـ\-_]/g, '').replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  return `${compact.replace(/[0-9]/g, '')}${compact.replace(/[^0-9]/g, '')}`;
}

export function normalizeEgyptMobile(value) {
  let digits = String(value || '').replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[^0-9+]/g, '');
  if (digits.startsWith('+20')) digits = digits.slice(3);
  else if (digits.startsWith('20') && digits.length === 12) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (!/^1[0125][0-9]{8}$/.test(digits)) {
    throw Object.assign(new Error('请输入有效的埃及手机号（010、011、012 或 015 开头）'), { code: 'INVALID_EGYPT_MOBILE', statusCode: 422 });
  }
  return `+20${digits}`;
}

function maskedPhone(value) {
  const text = String(value || '');
  return text.length > 7 ? `${text.slice(0, 5)}****${text.slice(-3)}` : '****';
}

function bindingError(code, message, statusCode = 422, retryAfterMs = 0) {
  return Object.assign(new Error(message), { code, statusCode, ...(retryAfterMs ? { retryAfterMs } : {}) });
}

function scheduleHours(value, config) {
  const hours = value == null || value === '' ? config.smsScheduleDefaultHours : Number(value);
  if (!Number.isInteger(hours) || hours < 24 || hours > config.smsScheduleMaxHours) {
    throw bindingError('INVALID_SMS_SCHEDULE_INTERVAL', `自动查询周期应为 24～${config.smsScheduleMaxHours} 小时的整数`, 422);
  }
  return hours;
}

function validateUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) {
    throw Object.assign(new Error('短信接口必须使用 HTTPS'), { code: 'INVALID_SMS_API_URL', statusCode: 422 });
  }
  return url.toString().replace(/\/$/, '');
}

function defaultHealthUrl(apiUrl) {
  return new URL('/api/v1/health', apiUrl).toString().replace(/\/$/, '');
}

function validateRules(rules) {
  if (!Array.isArray(rules) || rules.length > 100) throw Object.assign(new Error('短信通知规则最多 100 条'), { code: 'INVALID_SMS_RULES', statusCode: 422 });
  const ids = new Set();
  return rules.map(input => {
    const type = input.type === 'plate' ? 'plate' : input.type === 'document' ? 'document' : '';
    const matchValue = normalizeSmsMatch(type, input.matchValue);
    const to = String(input.to || '').replace(/[\s()-]/g, '');
    const template = String(input.template || '').trim();
    if (!type || !matchValue) throw Object.assign(new Error('每条规则必须填写匹配类型和值'), { code: 'INVALID_SMS_RULE', statusCode: 422 });
    if (!/^\+?\d{6,20}$/.test(to)) throw Object.assign(new Error('短信接收号码格式无效'), { code: 'INVALID_SMS_PHONE', statusCode: 422 });
    if (template.length > 500) throw Object.assign(new Error('短信模板不能超过 500 个字符'), { code: 'INVALID_SMS_TEMPLATE', statusCode: 422 });
    const id = /^[a-zA-Z0-9_-]{8,80}$/.test(String(input.id || '')) ? String(input.id) : `smsrule_${crypto.randomUUID()}`;
    if (ids.has(id)) throw Object.assign(new Error('短信规则 ID 重复'), { code: 'DUPLICATE_SMS_RULE', statusCode: 422 });
    ids.add(id);
    return { id, enabled: input.enabled !== false, type, matchValue, to, template };
  });
}

function plateOf(record) {
  const request = record.request || {};
  return `${[request.letter1, request.letter2, request.letter3].filter(Boolean).join(' ')} ${request.plateNumber || ''}`.trim();
}

function defaultMessage(record) {
  const plate = plateOf(record);
  if (record.status === 'success') {
    return `埃及车辆违章查询：${plate}，违章 ${record.result?.violationCount ?? 0} 笔，总罚款 ${record.result?.totalFine || '0 جنيه'}。追踪号 ${record.traceId}`;
  }
  return `埃及车辆违章查询：${plate}，查询失败：${record.error?.message || record.detail || '未知错误'}。追踪号 ${record.traceId}`;
}

function numericValue(value) {
  const normalized = String(value ?? '')
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/,/g, '');
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function compactNumber(value) {
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function signedNumber(value) {
  return `${value > 0 ? '+' : ''}${compactNumber(value)}`;
}

export function periodicResultMessage(record, previousResult = null) {
  const current = record.result || {};
  const plate = plateOf(record);
  const currentCount = numericValue(current.violationCount);
  const currentFine = numericValue(current.totalFine);
  const countText = currentCount == null ? String(current.violationCount ?? '—') : compactNumber(currentCount);
  const fineText = currentFine == null ? String(current.totalFine || '—') : `${compactNumber(currentFine)} جنيه`;
  const cumulative = `累计 ${countText}笔 / ${fineText}`;
  if (!previousResult) return `周期查询 ${plate}｜首次记录｜${cumulative}`;

  const previousCount = numericValue(previousResult.violationCount);
  const previousFine = numericValue(previousResult.totalFine);
  if (currentCount == null || currentFine == null || previousCount == null || previousFine == null) {
    const unchanged = String(current.violationCount) === String(previousResult.violationCount)
      && String(current.totalFine) === String(previousResult.totalFine);
    return `周期查询 ${plate}｜${unchanged ? '本期无变化' : '本期有变化'}｜${cumulative}`;
  }
  const countDelta = currentCount - previousCount;
  const fineDelta = currentFine - previousFine;
  const change = countDelta === 0 && fineDelta === 0
    ? '本期无变化'
    : `本期 ${signedNumber(countDelta)}笔 / ${signedNumber(fineDelta)} جنيه`;
  return `周期查询 ${plate}｜${change}｜${cumulative}`;
}

function renderTemplate(template, record) {
  if (!template) return defaultMessage(record);
  const values = {
    plate: plateOf(record), document: record.request?.documentNumber || '', status: record.status,
    totalFine: record.result?.totalFine || '', violations: record.result?.violationCount ?? '',
    error: record.error?.message || record.detail || '', traceId: record.traceId
  };
  return template.replace(/\{(plate|document|status|totalFine|violations|error|traceId)\}/g, (_all, key) => String(values[key]));
}

function ruleMatches(rule, record) {
  const request = record.request || {};
  const candidate = rule.type === 'document'
    ? request.documentNumber
    : `${[request.letter1, request.letter2, request.letter3].filter(Boolean).join('')}${request.plateNumber || ''}`;
  return normalizeSmsMatch(rule.type, candidate) === rule.matchValue;
}

export class SmsNotifier {
  constructor({ store, logger, config, secretStore, fetchImpl = fetch }) {
    Object.assign(this, { store, logger, config, secretStore, fetchImpl });
    this.running = false;
    this.healthRunning = false;
    this.healthTimer = null;
    this.health = { status: 'unknown', lastCheckedAt: null, code: 'SMS_HEALTH_PENDING', message: '短信服务等待首次检测' };
    queueMicrotask(() => this.drain());
  }

  getConfig() {
    const saved = this.store.getSetting(SETTING_KEY) || {};
    let storedToken = '';
    try { storedToken = this.secretStore.decrypt(this.store.getSetting(TOKEN_KEY)); } catch (error) {
      this.logger.error('sms_token_decrypt_failed', { error: { message: error.message } });
    }
    const tokenSource = this.config.smsApiToken ? 'environment' : storedToken ? 'admin' : 'none';
    return {
      enabled: saved.enabled === true,
      apiUrl: saved.apiUrl || this.config.smsApiUrl,
      healthUrl: saved.healthUrl || this.config.smsHealthUrl || defaultHealthUrl(saved.apiUrl || this.config.smsApiUrl),
      rules: Array.isArray(saved.rules) ? saved.rules : [],
      tokenConfigured: Boolean(this.config.smsApiToken || storedToken), tokenSource
    };
  }

  token() {
    if (this.config.smsApiToken) return this.config.smsApiToken;
    return this.secretStore.decrypt(this.store.getSetting(TOKEN_KEY));
  }

  configure(input) {
    const current = this.getConfig();
    const rules = validateRules(input.rules ?? current.rules);
    const apiUrl = validateUrl(input.apiUrl || current.apiUrl);
    const healthUrl = validateUrl(input.healthUrl || current.healthUrl || defaultHealthUrl(apiUrl));
    const next = { enabled: input.enabled === true, apiUrl, healthUrl, rules };
    if (input.clearToken === true && !this.config.smsApiToken) this.store.setSetting(TOKEN_KEY, null);
    else if (String(input.token || '').trim()) this.store.setSetting(TOKEN_KEY, this.secretStore.encrypt(String(input.token).trim()));
    this.store.setSetting(SETTING_KEY, next);
    this.logger.info('sms_config_updated', { enabled: next.enabled, apiHost: new URL(next.apiUrl).host, ruleCount: rules.length, tokenChanged: Boolean(input.clearToken || String(input.token || '').trim()) });
    if (next.enabled) queueMicrotask(() => this.drain());
    if (this.healthTimer) queueMicrotask(() => this.checkHealth());
    return this.getConfig();
  }

  startHealthMonitor() {
    if (this.healthTimer) return;
    void this.checkHealth();
    this.healthTimer = setInterval(() => void this.checkHealth(), this.config.smsHealthIntervalMs);
    this.healthTimer.unref?.();
  }

  stopHealthMonitor() {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
  }

  healthSnapshot() {
    const settings = this.getConfig();
    if (!settings.enabled) return { status: 'offline', lastCheckedAt: this.health.lastCheckedAt, code: 'SMS_DISABLED', message: '短信通知服务未启用' };
    if (!settings.tokenConfigured) return { status: 'unknown', lastCheckedAt: this.health.lastCheckedAt, code: 'SMS_TOKEN_MISSING', message: '短信服务尚未完成配置' };
    return { ...this.health };
  }

  async checkHealth() {
    if (this.healthRunning) return this.healthSnapshot();
    const settings = this.getConfig();
    if (!settings.enabled || !settings.tokenConfigured) {
      const status = settings.enabled ? 'unknown' : 'offline';
      const code = settings.enabled ? 'SMS_TOKEN_MISSING' : 'SMS_DISABLED';
      const message = settings.enabled ? '短信服务尚未完成配置' : '短信通知服务未启用';
      this.health = { status, code, message, lastCheckedAt: new Date().toISOString() };
      this.store.addServiceEvent('sms', status, code, message);
      return this.healthSnapshot();
    }
    this.healthRunning = true;
    const checkedAt = new Date().toISOString();
    try {
      const response = await this.fetchImpl(settings.healthUrl, {
        method: 'GET', signal: AbortSignal.timeout(this.config.smsHealthTimeoutMs),
        headers: { authorization: `Bearer ${this.token()}`, accept: 'application/json' }
      });
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
      this.health = { status: 'operational', code: 'SMS_HEALTHY', message: '短信通知服务运行正常', lastCheckedAt: checkedAt };
      this.store.addServiceEvent('sms', 'operational', 'SMS_HEALTHY', this.health.message, { httpStatus: response.status });
    } catch (error) {
      const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
      const code = timeout ? 'SMS_HEALTH_TIMEOUT' : error.status ? 'SMS_HEALTH_HTTP_ERROR' : 'SMS_HEALTH_UNREACHABLE';
      const message = timeout ? '短信通知服务检测超时' : error.status ? `短信通知服务返回 HTTP ${error.status}` : '短信通知服务暂时无法连接';
      this.health = { status: 'outage', code, message, lastCheckedAt: checkedAt };
      this.store.addServiceEvent('sms', 'outage', code, message, { httpStatus: error.status || null });
      this.logger.warn('sms_health_check_failed', { code, error: { message: error.message } });
    } finally {
      this.healthRunning = false;
    }
    return this.healthSnapshot();
  }

  adminCreateBinding(record, { phone, intervalHours }) {
    if (!record || record.status !== 'success') throw bindingError('SMS_BINDING_QUERY_NOT_SUCCESS', '只能为查询成功的记录创建绑定', 409);
    const binding = this.store.createVerifiedSmsBinding({
      id: `smsb_admin_${crypto.randomUUID()}`, queryFingerprint: record.fingerprint, queryId: record.id,
      to: normalizeEgyptMobile(phone), deviceId: record.deviceId, sourceIp: record.sourceIp,
      intervalHours: scheduleHours(intervalHours, this.config), initialResult: record.result
    });
    this.queueBindingResult(record, binding);
    this.logger.info('sms_binding_admin_created', { bindingId: binding.id, queryId: record.id, intervalHours: binding.intervalHours, toMasked: maskedPhone(binding.to) });
    return binding;
  }

  adminUpdateBinding(id, input) {
    const current = this.store.getSmsBinding(id);
    if (!current) return null;
    const patch = {};
    if (input.phone !== undefined) patch.to = normalizeEgyptMobile(input.phone);
    if (input.intervalHours !== undefined) patch.intervalHours = scheduleHours(input.intervalHours, this.config);
    if (input.status !== undefined) {
      if (!['verified', 'paused'].includes(input.status)) throw bindingError('INVALID_SMS_BINDING_STATUS', '绑定状态只能是启用或暂停', 422);
      patch.status = input.status;
    }
    const binding = this.store.updateSmsBindingAdmin(id, patch);
    this.logger.info('sms_binding_admin_updated', { bindingId: id, status: binding.status, intervalHours: binding.intervalHours, toMasked: maskedPhone(binding.to) });
    return binding;
  }

  bindingStatus(record, { deviceId, sourceIp }) {
    const settings = this.getConfig();
    let binding = this.store.latestSmsBinding(record.fingerprint, deviceId, sourceIp);
    if (!binding || (binding.status !== 'verified' && !(binding.status === 'pending' && new Date(binding.expiresAt).getTime() > Date.now()))) {
      binding = this.store.verifiedSmsBindingForDevice(record.fingerprint, deviceId);
    }
    const usable = binding && (binding.status === 'verified' || (binding.status === 'pending' && new Date(binding.expiresAt).getTime() > Date.now()));
    return {
      available: settings.enabled && settings.tokenConfigured,
      status: usable ? binding.status : 'unbound',
      bindingId: usable && binding.status === 'pending' ? binding.id : null,
      phoneMasked: usable ? maskedPhone(binding.to) : '',
      expiresAt: usable && binding.status === 'pending' ? binding.expiresAt : null,
      resendAfter: usable && binding.status === 'pending' ? binding.resendAfter : null,
      intervalHours: usable ? binding.intervalHours : this.config.smsScheduleDefaultHours,
      nextRunAt: usable && binding.status === 'verified' ? binding.nextRunAt : null,
      lastRunAt: usable && binding.status === 'verified' ? binding.lastRunAt : null,
      countryCode: '+20'
    };
  }

  requestBinding(record, { deviceId, sourceIp }, phoneInput, intervalInput = null) {
    const settings = this.getConfig();
    if (!settings.enabled || !settings.tokenConfigured) throw bindingError('SMS_NOT_CONFIGURED', '短信服务尚未启用，请联系管理员', 503);
    const to = normalizeEgyptMobile(phoneInput);
    const intervalHours = scheduleHours(intervalInput, this.config);
    const already = this.store.verifiedSmsBindingForDevice(record.fingerprint, deviceId, to);
    if (already) {
      this.store.updateSmsBindingSchedule(already.id, intervalHours);
      return { ...this.bindingStatus(record, { deviceId, sourceIp }), status: 'verified', phoneMasked: maskedPhone(to), alreadyVerified: true };
    }
    const latest = this.store.latestSmsBinding(record.fingerprint, deviceId, sourceIp);
    const resendAt = latest?.status === 'pending' ? new Date(latest.resendAfter).getTime() : 0;
    if (resendAt > Date.now()) throw bindingError('SMS_CODE_COOLDOWN', '验证码已发送，请稍后再试', 429, resendAt - Date.now());

    const sinceIso = new Date(Date.now() - this.config.smsBindingWindowMs).toISOString();
    const usage = this.store.smsBindingUsage({ deviceId, sourceIp, recipient: to, sinceIso });
    if (usage.requests >= this.config.smsBindingRequestsPerDeviceIp) throw bindingError('SMS_BINDING_REQUEST_LIMIT', '此设备和网络的手机号配置次数已达周期上限', 429, this.config.smsBindingWindowMs);
    if (!usage.phoneSeen && usage.phones >= this.config.smsBindingPhonesPerDeviceIp) throw bindingError('SMS_BINDING_PHONE_LIMIT', '此设备和网络可配置的不同手机号已达周期上限', 429, this.config.smsBindingWindowMs);
    if (usage.queries >= this.config.smsBindingQueriesPerPhone) throw bindingError('SMS_BINDING_QUERY_LIMIT', '此手机号可绑定的查询条件已达周期上限', 429, this.config.smsBindingWindowMs);

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const salt = crypto.randomBytes(16).toString('base64url');
    const codeHash = crypto.scryptSync(code, salt, 32).toString('base64url');
    const id = `smsb_${crypto.randomUUID()}`;
    const binding = this.store.createSmsBinding({
      id, queryFingerprint: record.fingerprint, queryId: record.id, to, deviceId, sourceIp,
      codeSalt: salt, codeHash,
      intervalHours,
      expiresAt: new Date(Date.now() + this.config.smsBindingCodeTtlMs).toISOString(),
      resendAfter: new Date(Date.now() + this.config.smsBindingResendMs).toISOString()
    });
    this.queueMessage(record, {
      ruleId: `verify_${id}`, matchType: 'verification', matchValue: id, to,
      text: `埃及车辆违章查询验证码：${code}。${Math.ceil(this.config.smsBindingCodeTtlMs / 60_000)} 分钟内有效，请勿告知他人。`
    });
    this.logger.info('sms_binding_code_queued', { queryId: record.id, traceId: record.traceId, bindingId: id, deviceId, sourceIp, toMasked: maskedPhone(to) });
    return { ...this.bindingStatus(record, { deviceId, sourceIp }), status: 'pending', bindingId: binding.id, phoneMasked: maskedPhone(to), expiresAt: binding.expiresAt, resendAfter: binding.resendAfter };
  }

  verifyBinding(record, { deviceId, sourceIp }, { bindingId, code }) {
    const binding = this.store.getSmsBinding(String(bindingId || ''));
    if (!binding || binding.queryFingerprint !== record.fingerprint || binding.deviceId !== deviceId || binding.sourceIp !== sourceIp) {
      throw bindingError('SMS_BINDING_NOT_FOUND', '验证码配置不存在或不属于当前设备', 404);
    }
    if (binding.status === 'verified') return this.bindingStatus(record, { deviceId, sourceIp });
    if (binding.status !== 'pending' || new Date(binding.expiresAt).getTime() <= Date.now()) throw bindingError('SMS_CODE_EXPIRED', '验证码已过期，请重新发送', 422);
    if (binding.verifyAttempts >= this.config.smsBindingVerifyAttempts) throw bindingError('SMS_CODE_ATTEMPTS_EXCEEDED', '验证码错误次数过多，请重新发送', 429);
    const supplied = String(code || '').trim();
    const expectedHash = Buffer.from(binding.codeHash, 'base64url');
    const suppliedHash = Buffer.from(crypto.scryptSync(supplied, binding.codeSalt, 32));
    if (!/^[0-9]{6}$/.test(supplied) || suppliedHash.length !== expectedHash.length || !crypto.timingSafeEqual(suppliedHash, expectedHash)) {
      const failed = this.store.recordSmsBindingFailure(binding.id);
      const remaining = Math.max(0, this.config.smsBindingVerifyAttempts - failed.verifyAttempts);
      throw bindingError('SMS_CODE_INVALID', `验证码不正确，还可尝试 ${remaining} 次`, 422);
    }
    const verified = this.store.verifySmsBinding(binding.id);
    this.store.updateSmsBindingLastResult(binding.id, record.result);
    this.queueBindingResult(record, verified);
    this.logger.info('sms_binding_verified', { queryId: record.id, traceId: record.traceId, bindingId: binding.id, deviceId, sourceIp, toMasked: maskedPhone(binding.to) });
    return { ...this.bindingStatus(record, { deviceId, sourceIp }), status: 'verified', phoneMasked: maskedPhone(binding.to) };
  }

  updateBindingSchedule(record, { deviceId, sourceIp }, intervalInput) {
    const intervalHours = scheduleHours(intervalInput, this.config);
    let binding = this.store.latestSmsBinding(record.fingerprint, deviceId, sourceIp);
    if (!binding || binding.status !== 'verified') binding = this.store.verifiedSmsBindingForDevice(record.fingerprint, deviceId);
    if (!binding || binding.status !== 'verified') throw bindingError('SMS_BINDING_NOT_FOUND', '当前查询尚未完成手机号验证', 404);
    this.store.updateSmsBindingSchedule(binding.id, intervalHours);
    this.logger.info('sms_binding_schedule_updated', {
      queryId: record.id, traceId: record.traceId, bindingId: binding.id,
      deviceId, sourceIp, intervalHours, toMasked: maskedPhone(binding.to)
    });
    return this.bindingStatus(record, { deviceId, sourceIp });
  }

  queueMessage(record, { ruleId, matchType, matchValue, to, text }) {
    const settings = this.getConfig();
    const delivery = this.store.createSmsDelivery({
      id: `smsd_${crypto.randomUUID()}`, queryId: record.id, traceId: record.traceId, ruleId,
      matchType, matchValue, to, text, idempotencyKey: `ppo-${record.id}-${ruleId}`, apiUrl: settings.apiUrl
    });
    if (delivery) this.drain();
    return delivery;
  }

  queueBindingResult(record, binding) {
    return this.queueMessage(record, {
      ruleId: `userbind_${binding.id}`, matchType: 'query', matchValue: record.fingerprint,
      to: binding.to, text: defaultMessage(record)
    });
  }

  queuePeriodicResult(record, binding) {
    const original = this.store.getQuery(binding.queryId);
    const previousResult = binding.lastResult || original?.result || null;
    return this.queueMessage(record, {
      ruleId: `userbind_${binding.id}`, matchType: 'periodic_binding', matchValue: binding.id,
      to: binding.to, text: periodicResultMessage(record, previousResult)
    });
  }

  handleTerminal(record) {
    if (!['success', 'failed'].includes(record?.status)) return 0;
    const settings = this.getConfig();
    if (!settings.enabled || !settings.tokenConfigured) return 0;
    let created = 0;
    for (const rule of settings.rules.filter(rule => rule.enabled && ruleMatches(rule, record))) {
      const delivery = this.store.createSmsDelivery({
        id: `smsd_${crypto.randomUUID()}`, queryId: record.id, traceId: record.traceId, ruleId: rule.id,
        matchType: rule.type, matchValue: rule.matchValue, to: rule.to, text: renderTemplate(rule.template, record),
        idempotencyKey: `ppo-${record.id}-${rule.id}`, apiUrl: settings.apiUrl
      });
      if (delivery) created += 1;
    }
    if (record.status === 'success') {
      const bindings = record.source === 'scheduled_sms'
        ? [this.store.smsBindingByLastQueryId(record.id)].filter(Boolean)
        : this.store.listVerifiedSmsBindings(record.fingerprint);
      for (const binding of bindings) {
        const delivery = record.source === 'scheduled_sms'
          ? this.queuePeriodicResult(record, binding)
          : this.queueBindingResult(record, binding);
        if (delivery) created += 1;
      }
    }
    if (created) {
      this.logger.info('sms_notifications_queued', { queryId: record.id, traceId: record.traceId, count: created });
      this.drain();
    }
    return created;
  }

  async drain() {
    if (this.running) return;
    if (!this.getConfig().enabled) return;
    this.running = true;
    try {
      let delivery;
      while ((delivery = this.store.nextSmsDelivery())) await this.send(delivery);
    } finally {
      this.running = false;
      // A delivery can be queued after the loop's final read while another send
      // is still unwinding. Recheck on the next microtask so it is not stranded.
      if (this.store.nextSmsDelivery()) queueMicrotask(() => this.drain());
    }
  }

  async send(delivery) {
    const maskedTo = delivery.to.length > 4 ? `${'*'.repeat(delivery.to.length - 4)}${delivery.to.slice(-4)}` : '****';
    const token = this.token();
    if (!token) {
      this.store.updateSmsDelivery(delivery.id, { status: 'failed', error: '短信接口令牌未配置' });
      return;
    }
    this.store.updateSmsDelivery(delivery.id, { status: 'sending', attempts: delivery.attempts + 1 });
    try {
      const response = await this.fetchImpl(delivery.apiUrl, {
        method: 'POST', signal: AbortSignal.timeout(this.config.smsTimeoutMs),
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': delivery.idempotencyKey },
        body: JSON.stringify({ to: delivery.to, text: delivery.text })
      });
      let payload = {}; try { payload = await response.json(); } catch {}
      if (!response.ok) throw Object.assign(new Error(payload?.error?.message || `短信接口返回 HTTP ${response.status}`), { retryable: response.status === 429 || response.status >= 500 });
      const message = payload?.message || {};
      this.store.updateSmsDelivery(delivery.id, { status: 'accepted', providerMessageId: message.id || '', providerStatus: message.status || 'accepted', error: '' });
      if (delivery.matchType === 'periodic_binding') {
        const record = this.store.getQuery(delivery.queryId);
        if (record?.result) this.store.updateSmsBindingLastResult(delivery.matchValue, record.result);
      }
      this.logger.info('sms_notification_accepted', { queryId: delivery.queryId, traceId: delivery.traceId, deliveryId: delivery.id, providerMessageId: message.id || null, providerStatus: message.status || 'accepted', toMasked: maskedTo });
    } catch (error) {
      const latest = this.store.getSmsDelivery(delivery.id);
      if (error.retryable && latest.attempts < this.config.smsMaxAttempts) {
        this.store.updateSmsDelivery(delivery.id, { status: 'queued', error: error.message });
        this.logger.warn('sms_notification_retry', { queryId: delivery.queryId, traceId: delivery.traceId, deliveryId: delivery.id, attempt: latest.attempts, error: { message: error.message }, toMasked: maskedTo });
      } else {
        this.store.updateSmsDelivery(delivery.id, { status: 'failed', error: error.name === 'TimeoutError' ? '短信接口请求超时' : error.message });
        this.logger.error('sms_notification_failed', { queryId: delivery.queryId, traceId: delivery.traceId, deliveryId: delivery.id, attempt: latest.attempts, error: { message: error.message }, toMasked: maskedTo });
      }
    }
  }
}
