import crypto from 'node:crypto';

const SETTING_KEY = 'sms_notification_config';
const TOKEN_KEY = 'sms_api_token_encrypted';

export function normalizeSmsMatch(type, value) {
  const text = String(value || '').normalize('NFC').trim();
  if (type === 'document') return text.replace(/\s+/g, '').toUpperCase();
  const compact = text.replace(/[\sـ\-_]/g, '').replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  return `${compact.replace(/[0-9]/g, '')}${compact.replace(/[^0-9]/g, '')}`;
}

function validateUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) {
    throw Object.assign(new Error('短信接口必须使用 HTTPS'), { code: 'INVALID_SMS_API_URL', statusCode: 422 });
  }
  return url.toString().replace(/\/$/, '');
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
    const next = { enabled: input.enabled === true, apiUrl: validateUrl(input.apiUrl || current.apiUrl), rules };
    if (input.clearToken === true && !this.config.smsApiToken) this.store.setSetting(TOKEN_KEY, null);
    else if (String(input.token || '').trim()) this.store.setSetting(TOKEN_KEY, this.secretStore.encrypt(String(input.token).trim()));
    this.store.setSetting(SETTING_KEY, next);
    this.logger.info('sms_config_updated', { enabled: next.enabled, apiHost: new URL(next.apiUrl).host, ruleCount: rules.length, tokenChanged: Boolean(input.clearToken || String(input.token || '').trim()) });
    if (next.enabled) queueMicrotask(() => this.drain());
    return this.getConfig();
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
    } finally { this.running = false; }
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
