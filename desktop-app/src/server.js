import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { config } from './config.js';
import { Store } from './db.js';
import { AuditLogger } from './logger.js';
import { RateLimiter, eventStreamLifetime, summarizeEventStreams } from './rate-limit.js';
import { PPOQueryDriver } from './query-driver.js';
import { QueryQueue, publicEvent, publicRecord } from './queue.js';
import { parseOfficialSummary } from './result-parser.js';
import { validateQueryPayload } from './validation.js';
import { AdminAuth } from './admin-auth.js';
import { IpGeoResolver } from './ip-geo.js';
import { isTrustedProxyRequest, resolveClientIp } from './client-ip.js';
import { decodeFeedbackAttachments, feedbackAttachmentPath, saveFeedbackAttachments } from './feedback-attachments.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.logDir, { recursive: true });
const logger = new AuditLogger(config.logDir);
logger.cleanup(config.logRetentionDays);
const store = new Store(config.dataDir);
store.cleanupServiceEvents(config.logRetentionDays);
const limiter = new RateLimiter(config);
const adminAuth = new AdminAuth({ store, config, logger });
const geoResolver = new IpGeoResolver({ store, config, logger });
const clients = new Set();
let queue;
function sendEvent(client, payload) {
  if (client.response.destroyed || client.response.writableEnded) {
    clients.delete(client);
    return;
  }
  try { client.response.write(payload); client.lastActivityAt = Date.now(); }
  catch { clients.delete(client); }
}
const broadcast = record => {
  for (const client of clients) {
    const ownsRecord = record?.deviceId === client.deviceId;
    const payload = {
      type: 'query',
      query: ownsRecord ? publicRecord(record, true) : null,
      queue: queue.publicSnapshot(client.deviceId)
    };
    sendEvent(client, `data: ${JSON.stringify(payload)}\n\n`);
  }
};
const driver = new PPOQueryDriver(config, logger);

let repairedResultCount = 0;
for (const record of store.list(500, ['success'])) {
  if (!record.result?.rawText) continue;
  const summary = parseOfficialSummary(record.result.rawText);
  if (summary.totalFine === record.result.totalFine
    && summary.violationCount === record.result.violationCount
    && summary.reconcileFine === record.result.reconcileFine) continue;
  store.updateQuery(record.id, { result: { ...record.result, ...summary } });
  repairedResultCount += 1;
}
if (repairedResultCount) logger.info('stored_results_reparsed', { repairedCount: repairedResultCount });

queue = new QueryQueue({ store, driver, config, logger, broadcast });
const heartbeatTimer = setInterval(() => {
  const now = Date.now();
  for (const client of clients) {
    if (now >= client.expiresAt) {
      clients.delete(client);
      try {
        client.response.write(`data: ${JSON.stringify({ type: 'stream_reset', retryAfterMs: 250 + Math.floor(Math.random() * 750) })}\n\n`);
        client.response.end();
      } catch {}
      logger.info('event_stream_recycled', { sourceIp: client.ip, deviceId: client.deviceId, streamId: client.streamId, connectedMs: now - client.connectedAt });
      continue;
    }
    sendEvent(client, ': keep-alive\n\n');
  }
}, 25_000);
heartbeatTimer.unref();
const publicDir = path.join(config.appRoot, 'public');
let boundPort = config.port;

function statusSnapshot({ includeInternal = false, eventLimit = 20, eventCursor = '', eventOffset = 0 } = {}) {
  const sinceIso = new Date(Date.now() - 86_400_000).toISOString();
  const statistics = store.queryStatistics(sinceIso);
  const serviceEvents = store.listServiceEvents(100, sinceIso);
  const latestOfficial = serviceEvents.find(event => event.component === 'official') || null;
  const officialIsFresh = latestOfficial && Date.now() - new Date(latestOfficial.createdAt).getTime() <= 6 * 3_600_000;
  const queueState = queue.publicSnapshot('');
  const circuitOpen = queueState.circuit.open;
  const officialStatus = circuitOpen ? 'outage' : (officialIsFresh ? latestOfficial.status : 'unknown');
  const publicEventPage = store.listServiceEventsPage({
    limit: eventLimit,
    cursor: eventCursor,
    offset: eventOffset,
    sinceIso,
    components: ['server', 'official', 'queue']
  });
  const publicEvents = publicEventPage.items
    .map(({ id, component, status, code, message, createdAt }) => ({ id, component, status, code, message, createdAt }));
  const value = {
    generatedAt: new Date().toISOString(),
    server: { status: 'operational', uptimeSeconds: Math.floor(process.uptime()) },
    official: {
      status: officialStatus,
      lastCheckedAt: latestOfficial?.createdAt || null,
      lastCode: latestOfficial?.code || null,
      message: circuitOpen ? '连续异常，当前处于保护性暂停状态' : (officialIsFresh ? latestOfficial.message : '最近没有足够新的官网查询样本')
    },
    queries24h: statistics,
    queue: {
      running: queueState.runningCount,
      queued: queueState.queuedCount,
      capacity: queueState.capacity,
      accepting: queueState.accepting,
      circuit: queueState.circuit
    },
    flow24h: {
      rateLimited: store.countServiceEvents('rate_limit', sinceIso),
      queueRejected: store.countServiceEvents('queue', sinceIso, ['QUEUE_FULL', 'CIRCUIT_REJECTED']),
      eventStreamsRejected: store.countServiceEvents('rate_limit', sinceIso, ['SSE_LIMIT'])
    },
    events: publicEvents,
    eventsPage: {
      limit: publicEventPage.limit,
      offset: publicEventPage.offset,
      hasMore: publicEventPage.hasMore,
      nextOffset: publicEventPage.nextOffset,
      nextCursor: publicEventPage.nextCursor,
      windowHours: 24
    }
  };
  if (includeInternal) value.internalEvents = serviceEvents;
  return value;
}

function adminSummaryRecord(record) {
  if (!record) return null;
  const value = { ...record };
  if (value.result?.rawText) {
    value.result = { ...value.result };
    delete value.result.rawText;
  }
  if (value.error?.stack || value.error?.diagnostic) {
    value.error = { ...value.error };
    delete value.error.stack;
    delete value.error.diagnostic;
  }
  return value;
}

const DIAGNOSTIC_FILE_FIELDS = {
  before: { field: 'preSubmitScreenshotPath', mime: 'image/png', extension: '.png', name: 'before-submit.png' },
  after: { field: 'screenshotPath', mime: 'image/png', extension: '.png', name: 'after-failure.png' },
  snapshot: { field: 'snapshotPath', mime: 'application/json; charset=utf-8', extension: '.json', name: 'diagnostic-snapshot.json' }
};

function diagnosticFile(record, kind) {
  const descriptor = DIAGNOSTIC_FILE_FIELDS[kind];
  const candidate = descriptor && record?.error?.diagnostic?.[descriptor.field];
  if (!candidate || path.extname(candidate).toLowerCase() !== descriptor.extension) return null;
  const root = path.resolve(config.dataDir, 'diagnostics');
  const resolved = path.resolve(candidate);
  if (!resolved.startsWith(`${root}${path.sep}`) || !fs.existsSync(resolved)) return null;
  try {
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(resolved);
    if (!realFile.startsWith(`${realRoot}${path.sep}`)) return null;
    return { ...descriptor, path: realFile };
  } catch {
    return null;
  }
}

function adminDetailRecord(record) {
  const value = adminSummaryRecord(record);
  const sourceDiagnostic = record?.error?.diagnostic;
  if (record?.error && sourceDiagnostic) {
    value.error = {
      ...value.error,
      diagnostic: {
        reason: sourceDiagnostic.reason || null,
        url: sourceDiagnostic.url || null,
        title: sourceDiagnostic.title || null,
        userAgent: sourceDiagnostic.userAgent || null,
        readyState: sourceDiagnostic.readyState || null,
        bodyLength: sourceDiagnostic.bodyLength || 0,
        dialogCount: sourceDiagnostic.dialogCount || 0,
        submitState: sourceDiagnostic.submitState || null
      }
    };
  }
  value.diagnostics = {
    before: Boolean(diagnosticFile(record, 'before')),
    after: Boolean(diagnosticFile(record, 'after')),
    snapshot: Boolean(diagnosticFile(record, 'snapshot'))
  };
  return value;
}

function json(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  response.end(JSON.stringify(body));
}

async function body(request, { maxBytes = 32_768 } = {}) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw Object.assign(new Error('请求内容过大'), { statusCode: 413, code: 'BODY_TOO_LARGE' });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw || '{}'); }
  catch { throw Object.assign(new Error('JSON 格式错误'), { statusCode: 400, code: 'INVALID_JSON' }); }
}

function clientIp(request) {
  return resolveClientIp(request, config);
}

function proxyTrusted(request) {
  return isTrustedProxyRequest(request, config);
}

function secureRequest(request) {
  return Boolean(request.socket.encrypted) || (proxyTrusted(request) && String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
}

function isPrivileged(request) {
  const key = String(request.headers['x-api-key'] || '');
  if (!key || !config.apiKeys.size) return false;
  return [...config.apiKeys].some(expected => {
    const a = Buffer.from(key); const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

function isDesktopRequest(request) {
  const supplied = String(request.headers['x-desktop-token'] || '');
  const expected = String(config.desktopToken || '');
  if (!supplied || !expected) return false;
  const a = Buffer.from(supplied); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function adminContext(request) {
  if (isDesktopRequest(request)) return { desktop: true, session: null };
  const session = adminAuth.session(request);
  return session ? { desktop: false, session } : null;
}

function requireAdmin(request) {
  const context = adminContext(request);
  if (!context) throw Object.assign(new Error('请先登录管理后台'), { statusCode: 401, code: 'ADMIN_AUTH_REQUIRED' });
  return context;
}

function cleanFeedback(payload) {
  const stripControls = value => String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  const content = stripControls(payload?.content);
  const phone = stripControls(payload?.phone);
  const wechat = stripControls(payload?.wechat);
  const pageUrl = stripControls(payload?.pageUrl).slice(0, 500);
  if (content.length < 2 || content.length > 2_000) throw Object.assign(new Error('反馈内容应为 2～2000 个字符'), { statusCode: 422, code: 'INVALID_FEEDBACK_CONTENT' });
  if (phone.length > 40 || (phone && !/^[+0-9()\-\s]{3,40}$/.test(phone))) throw Object.assign(new Error('手机号格式不正确'), { statusCode: 422, code: 'INVALID_FEEDBACK_PHONE' });
  if (wechat.length > 64) throw Object.assign(new Error('微信号不能超过 64 个字符'), { statusCode: 422, code: 'INVALID_FEEDBACK_WECHAT' });
  return { content, phone, wechat, pageUrl };
}

function deviceIdentity(request, url, { required = true, privileged = false } = {}) {
  const supplied = String(request.headers['x-device-id'] || url.searchParams.get('deviceId') || '').trim().slice(0, 128);
  if (/^[A-Za-z0-9._:-]{8,128}$/.test(supplied)) return supplied;
  if (privileged) return `api:${crypto.createHash('sha256').update(clientIp(request)).digest('hex').slice(0, 24)}`;
  if (!required) return '';
  throw Object.assign(new Error('缺少有效的设备标识，请刷新页面后重试'), { code: 'DEVICE_ID_REQUIRED', statusCode: 400 });
}

function applyCors(request, response) {
  const origin = String(request.headers.origin || '').replace(/\/$/, '');
  if (!origin || !config.corsOrigins.has(origin)) return false;
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('vary', 'Origin');
  response.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  response.setHeader('access-control-allow-headers', 'Content-Type,X-API-Key,X-Device-Id,X-CSRF-Token');
  response.setHeader('access-control-max-age', '600');
  return true;
}

function staticFile(requestPath, response) {
  const normalized = requestPath === '/' ? 'index.html' : (requestPath === '/admin' || requestPath === '/admin/') ? 'admin.html' : requestPath.replace(/^\/+/, '');
  const resolved = path.resolve(publicDir, normalized);
  if (!resolved.startsWith(`${publicDir}${path.sep}`) || !fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) return false;
  const type = resolved.endsWith('.html') ? 'text/html' : resolved.endsWith('.css') ? 'text/css' : resolved.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
  response.writeHead(200, {
    'content-type': `${type}; charset=utf-8`,
    'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
    'pragma': 'no-cache',
    'expires': '0'
  });
  fs.createReadStream(resolved).pipe(response);
  return true;
}

export const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  applyCors(request, response);
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('referrer-policy', 'same-origin');
  response.setHeader('content-security-policy', "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  response.setHeader('cross-origin-resource-policy', 'same-origin');
  try {
    if (request.method === 'OPTIONS') {
      if (!applyCors(request, response)) return json(response, 403, { error: { code: 'CORS_DENIED', message: '该来源未获准跨域调用' } });
      response.writeHead(204); response.end(); return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/health') {
      const deviceId = deviceIdentity(request, url, { required: false });
      return json(response, 200, { ok: true, version: config.appVersion, uptimeSeconds: Math.floor(process.uptime()), queue: queue.publicSnapshot(deviceId) });
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/status') {
      return json(response, 200, statusSnapshot({
        eventLimit: Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20)),
        eventCursor: url.searchParams.get('cursor') || '',
        eventOffset: Math.max(0, Number(url.searchParams.get('offset')) || 0)
      }));
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/admin/auth/status') {
      const context = adminContext(request);
      return json(response, 200, {
        authenticated: Boolean(context), desktop: Boolean(context?.desktop), passwordConfigured: adminAuth.hasPassword(),
        csrfToken: context?.session?.csrfToken || null
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/admin/login') {
      const ip = clientIp(request);
      const rate = adminAuth.checkLoginRate(ip);
      if (!rate.allowed) {
        logger.warn('admin_login_rate_limited', { sourceIp: ip, retryAfterMs: rate.retryAfterMs });
        store.addServiceEvent('rate_limit', 'warning', 'ADMIN_LOGIN_LIMIT', '管理员登录触发流控', { sourceIp: ip }, { force: true });
        return json(response, 429, { error: { code: 'ADMIN_LOGIN_LIMIT', message: '登录尝试过多，请稍后再试', retryAfterMs: rate.retryAfterMs } }, { 'retry-after': String(Math.ceil(rate.retryAfterMs / 1000)) });
      }
      const payload = await body(request);
      if (!adminAuth.hasPassword() || !adminAuth.verifyPassword(String(payload.password || ''))) {
        adminAuth.recordFailure(ip);
        logger.warn('admin_login_failed', { sourceIp: ip, userAgent: String(request.headers['user-agent'] || '').slice(0, 300) });
        return json(response, 401, { error: { code: 'ADMIN_LOGIN_FAILED', message: adminAuth.hasPassword() ? '管理员密码错误' : '尚未设置远程管理员密码，请先在桌面程序中设置' } });
      }
      const session = adminAuth.createSession({ ip, userAgent: String(request.headers['user-agent'] || '').slice(0, 500) });
      logger.info('admin_login_succeeded', { sourceIp: ip });
      return json(response, 200, { authenticated: true, csrfToken: session.csrfToken }, { 'set-cookie': adminAuth.sessionCookie(session, secureRequest(request)) });
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/admin/logout') {
      const context = requireAdmin(request);
      adminAuth.assertCsrf(request, context);
      adminAuth.invalidate(request);
      logger.info('admin_logout', { sourceIp: clientIp(request), desktop: context.desktop });
      return json(response, 200, { ok: true }, { 'set-cookie': adminAuth.clearCookie(secureRequest(request)) });
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/admin/password') {
      const context = requireAdmin(request);
      adminAuth.assertCsrf(request, context);
      const payload = await body(request);
      if (!context.desktop && !adminAuth.verifyPassword(String(payload.currentPassword || ''))) {
        return json(response, 403, { error: { code: 'CURRENT_PASSWORD_INVALID', message: '当前管理员密码错误' } });
      }
      adminAuth.setPassword(String(payload.newPassword || ''));
      logger.info('admin_password_changed', { sourceIp: clientIp(request), desktop: context.desktop });
      return json(response, 200, { ok: true, reloginRequired: !context.desktop }, { 'set-cookie': adminAuth.clearCookie(secureRequest(request)) });
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/admin/overview') {
      requireAdmin(request);
      return json(response, 200, {
        status: statusSnapshot({ includeInternal: true }),
        queue: queue.snapshot(),
        eventStreams: summarizeEventStreams(clients, config),
        feedback: store.feedbackStatistics(),
        generatedAt: new Date().toISOString()
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/admin/core/status') {
      requireAdmin(request);
      const control = globalThis.__PPO_CORE_CONTROL__;
      return control
        ? json(response, 200, control.status())
        : json(response, 503, { error: { code: 'CORE_CONTROL_UNAVAILABLE', message: '当前运行方式不支持核心热更新' } });
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/admin/core/check') {
      const context = requireAdmin(request);
      adminAuth.assertCsrf(request, context);
      const control = globalThis.__PPO_CORE_CONTROL__;
      if (!control) return json(response, 503, { error: { code: 'CORE_CONTROL_UNAVAILABLE', message: '当前运行方式不支持核心热更新' } });
      try {
        const result = await control.check();
        logger.info('core_update_check_completed', {
          activeVersion: result.activeVersion || null,
          availableVersion: result.available?.version || null,
          sourceIp: clientIp(request),
          desktop: context.desktop
        });
        return json(response, 200, result);
      }
      catch (error) {
        logger.warn('core_update_check_failed', { error: { message: error.message, code: error.code } });
        return json(response, 502, { error: { code: 'CORE_UPDATE_CHECK_FAILED', message: error.message } });
      }
    }
    if (request.method === 'POST' && ['/api/v1/admin/core/update', '/api/v1/admin/core/rollback'].includes(url.pathname)) {
      const context = requireAdmin(request);
      adminAuth.assertCsrf(request, context);
      const control = globalThis.__PPO_CORE_CONTROL__;
      if (!control) return json(response, 503, { error: { code: 'CORE_CONTROL_UNAVAILABLE', message: '当前运行方式不支持核心热更新' } });
      const operation = url.pathname.endsWith('/rollback') ? 'rollback' : 'update';
      logger.info('core_operation_requested', { operation, sourceIp: clientIp(request), desktop: context.desktop });
      json(response, 202, { accepted: true, operation, message: operation === 'update' ? '核心更新已开始，切换期间会短暂显示维护页' : '核心回滚已开始' });
      setTimeout(() => control[operation]().catch?.(error => logger.error('core_operation_failed', { operation, error: { message: error.message, stack: error.stack } })), 100).unref?.();
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/admin/logs') {
      requireAdmin(request);
      const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 500);
      const page = logger.recentPage({
        limit,
        cursor: url.searchParams.get('cursor') || '',
        query: url.searchParams.get('q') || '',
        level: url.searchParams.get('level') || '',
        event: url.searchParams.get('event') || ''
      });
      return json(response, 200, {
        ...page,
        logDir: config.logDir,
        diagnosticsDir: path.join(config.dataDir, 'diagnostics'),
        generatedAt: new Date().toISOString()
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/admin/queries') {
      requireAdmin(request);
      const result = store.searchQueries({
        query: url.searchParams.get('q') || '',
        status: url.searchParams.get('status') || '',
        limit: Math.min(Number(url.searchParams.get('limit')) || 50, 200),
        cursor: url.searchParams.get('cursor') || '',
        offset: Math.max(0, Number(url.searchParams.get('offset')) || 0)
      });
      return json(response, 200, { ...result, items: result.items.map(adminSummaryRecord) });
    }
    const adminDetail = url.pathname.match(/^\/api\/v1\/admin\/queries\/([^/]+)$/);
    if (request.method === 'GET' && adminDetail) {
      requireAdmin(request);
      const record = store.getQuery(adminDetail[1]);
      return record ? json(response, 200, { ...adminDetailRecord(record), events: store.listEvents(record.id) }) : json(response, 404, { error: { code: 'NOT_FOUND', message: '查询任务不存在' } });
    }
    const adminDiagnostic = url.pathname.match(/^\/api\/v1\/admin\/queries\/([^/]+)\/diagnostics\/(before|after|snapshot)$/);
    if (request.method === 'GET' && adminDiagnostic) {
      requireAdmin(request);
      const record = store.getQuery(adminDiagnostic[1]);
      const file = record && diagnosticFile(record, adminDiagnostic[2]);
      if (!file) return json(response, 404, { error: { code: 'NOT_FOUND', message: '该查询没有可用的诊断文件' } });
      response.writeHead(200, {
        'content-type': file.mime,
        'content-length': String(fs.statSync(file.path).size),
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff'
      });
      fs.createReadStream(file.path).pipe(response);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/admin/feedback') {
      requireAdmin(request);
      return json(response, 200, store.listFeedback({
        query: url.searchParams.get('q') || '', status: url.searchParams.get('status') || '',
        limit: Math.min(Number(url.searchParams.get('limit')) || 50, 200),
        cursor: url.searchParams.get('cursor') || '', offset: Math.max(0, Number(url.searchParams.get('offset')) || 0)
      }));
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/admin/service-events') {
      requireAdmin(request);
      return json(response, 200, store.listServiceEventsPage({
        limit: Math.min(Number(url.searchParams.get('limit')) || 40, 200),
        cursor: url.searchParams.get('cursor') || ''
      }));
    }
    const adminFeedback = url.pathname.match(/^\/api\/v1\/admin\/feedback\/([^/]+)$/);
    if (request.method === 'GET' && adminFeedback) {
      requireAdmin(request);
      const item = store.getFeedback(adminFeedback[1]);
      return item ? json(response, 200, item) : json(response, 404, { error: { code: 'NOT_FOUND', message: '反馈不存在' } });
    }
    const adminFeedbackAttachment = url.pathname.match(/^\/api\/v1\/admin\/feedback\/([^/]+)\/attachments\/([^/]+)$/);
    if (request.method === 'GET' && adminFeedbackAttachment) {
      requireAdmin(request);
      const item = store.getFeedback(adminFeedbackAttachment[1]);
      const attachment = item?.attachments?.find(candidate => candidate.id === adminFeedbackAttachment[2]);
      const filePath = attachment && feedbackAttachmentPath(config.feedbackAttachmentDir, item.id, attachment.storedName);
      if (!filePath || !fs.existsSync(filePath)) return json(response, 404, { error: { code:'NOT_FOUND', message:'附件不存在' } });
      response.writeHead(200, {
        'content-type': attachment.mime,
        'content-length': String(fs.statSync(filePath).size),
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff'
      });
      fs.createReadStream(filePath).pipe(response);
      return;
    }
    if (request.method === 'PATCH' && adminFeedback) {
      const context = requireAdmin(request);
      adminAuth.assertCsrf(request, context);
      const payload = await body(request);
      if (!['new', 'read', 'resolved', 'archived'].includes(payload.status)) throw Object.assign(new Error('反馈状态无效'), { statusCode: 422, code: 'INVALID_FEEDBACK_STATUS' });
      const adminNote = String(payload.adminNote || '').trim();
      if (adminNote.length > 2_000) throw Object.assign(new Error('管理员备注不能超过 2000 个字符'), { statusCode: 422, code: 'INVALID_ADMIN_NOTE' });
      const item = store.updateFeedback(adminFeedback[1], { status: payload.status, adminNote });
      if (!item) return json(response, 404, { error: { code: 'NOT_FOUND', message: '反馈不存在' } });
      logger.info('feedback_status_updated', { feedbackId: item.id, status: item.status, sourceIp: clientIp(request) });
      return json(response, 200, item);
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/events') {
      const privileged = isPrivileged(request);
      const deviceId = deviceIdentity(request, url, { privileged });
      const ip = clientIp(request);
      const suppliedStreamId = String(url.searchParams.get('streamId') || '').trim().slice(0, 128);
      const streamId = /^[A-Za-z0-9._:-]{8,128}$/.test(suppliedStreamId) ? suppliedStreamId : `legacy:${crypto.randomUUID()}`;
      const replaced = [...clients].filter(client => client.deviceId === deviceId && client.streamId === streamId);
      for (const client of replaced) {
        clients.delete(client);
        try { client.response.end(); } catch {}
      }
      if (replaced.length) logger.info('event_stream_replaced', { sourceIp: ip, deviceId, streamId, replacedCount: replaced.length });
      const sameIpClients = [...clients].filter(client => client.ip === ip).length;
      if (clients.size >= config.maxEventClients || sameIpClients >= config.maxEventClientsPerIp) {
        logger.warn('event_stream_rejected', { sourceIp: ip, currentEventClients: clients.size, currentEventClientsForIp: sameIpClients, maxEventClients: config.maxEventClients, maxEventClientsPerIp: config.maxEventClientsPerIp });
        store.addServiceEvent('rate_limit', 'warning', 'SSE_LIMIT', '实时状态连接达到流控上限', { sourceIp: ip }, { force: true });
        return json(response, 503, { error: { code: 'EVENT_CLIENTS_FULL', message: '实时连接数已满，请稍后重试' } }, { 'retry-after': '30' });
      }
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      response.write(`data: ${JSON.stringify({ type: 'snapshot', queue: queue.publicSnapshot(deviceId) })}\n\n`);
      const connectedAt = Date.now();
      const client = { response, deviceId, streamId, ip, connectedAt, lastActivityAt: connectedAt, expiresAt: connectedAt + eventStreamLifetime(config) };
      clients.add(client);
      const cleanup = () => clients.delete(client);
      request.on('aborted', cleanup);
      request.on('close', cleanup);
      response.on('close', cleanup);
      response.on('error', cleanup);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/queue') {
      const privileged = isPrivileged(request);
      const deviceId = deviceIdentity(request, url, { privileged });
      return json(response, 200, queue.publicSnapshot(deviceId));
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/history') {
      const privileged = isPrivileged(request);
      const deviceId = deviceIdentity(request, url, { privileged });
      const limit = Math.min(Math.max(1, Number(url.searchParams.get('limit')) || 20), 100);
      const page = store.listPage({
        deviceId, privileged, limit, cursor: url.searchParams.get('cursor') || '',
        offset: Math.max(0, Number(url.searchParams.get('offset')) || 0)
      });
      return json(response, 200, {
        ...page,
        items: page.items.map(item => publicRecord(item, true))
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/feedback') {
      const ip = clientIp(request);
      const deviceId = deviceIdentity(request, url);
      const rate = limiter.checkFeedback({ ip, deviceId });
      if (!rate.allowed) {
        logger.warn('feedback_rate_limited', { sourceIp: ip, deviceId, code: rate.code, retryAfterMs: rate.retryAfterMs });
        store.addServiceEvent('rate_limit', 'warning', rate.code, '意见反馈触发流控', { sourceIp: ip }, { force: true });
        return json(response, 429, { error: { code: rate.code, message: '反馈提交过于频繁，请稍后再试', retryAfterMs: rate.retryAfterMs } }, { 'retry-after': String(Math.ceil(rate.retryAfterMs / 1000)) });
      }
      const payload = await body(request, { maxBytes: Math.ceil(config.feedbackAttachmentMaxTotalBytes * 4 / 3) + 256_000 });
      const input = cleanFeedback(payload);
      const decodedAttachments = decodeFeedbackAttachments(payload.attachments, {
        maxFiles: config.feedbackAttachmentMaxFiles,
        maxFileBytes: config.feedbackAttachmentMaxFileBytes,
        maxTotalBytes: config.feedbackAttachmentMaxTotalBytes
      });
      const createdAt = new Date().toISOString();
      const id = `fb_${crypto.randomUUID()}`;
      const attachments = saveFeedbackAttachments(config.feedbackAttachmentDir, id, decodedAttachments);
      const item = store.createFeedback({
        id, deviceId, sourceIp: ip, attachments,
        userAgent: String(request.headers['user-agent'] || '').slice(0, 500), ...input, createdAt
      });
      logger.info('feedback_submitted', { feedbackId: item.id, sourceIp: ip, deviceId, hasPhone: Boolean(input.phone), hasWechat: Boolean(input.wechat), attachmentCount: attachments.length, attachmentBytes: attachments.reduce((sum, entry) => sum + entry.size, 0) });
      void geoResolver.lookup(ip).then(geo => store.setFeedbackGeo(item.id, geo));
      return json(response, 201, { id: item.id, message: '感谢反馈，我们已收到。' });
    }
    const detail = url.pathname.match(/^\/api\/v1\/queries\/([^/]+)$/);
    if (request.method === 'GET' && detail) {
      const record = store.getQuery(detail[1]);
      const privileged = isPrivileged(request);
      const deviceId = deviceIdentity(request, url, { privileged });
      if (record && !privileged && record.deviceId !== deviceId) return json(response, 404, { error: { code: 'NOT_FOUND', message: '查询任务不存在' } });
      const events = record ? store.listEvents(record.id).map(publicEvent) : [];
      return record ? json(response, 200, { ...publicRecord(record, true), events }) : json(response, 404, { error: { code: 'NOT_FOUND', message: '查询任务不存在' } });
    }
    if (request.method === 'DELETE' && detail) {
      const existing = store.getQuery(detail[1]);
      const privileged = isPrivileged(request);
      const deviceId = deviceIdentity(request, url, { privileged });
      if (existing && !privileged && existing.deviceId !== deviceId) return json(response, 404, { error: { code: 'NOT_FOUND', message: '查询任务不存在' } });
      const record = queue.cancel(detail[1]);
      return record ? json(response, 200, publicRecord(record)) : json(response, 404, { error: { code: 'NOT_FOUND', message: '查询任务不存在或已结束' } });
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/queries') {
      const payload = await body(request);
      const ip = clientIp(request);
      const privileged = isPrivileged(request);
      const attemptRate = limiter.checkAttempt({ ip, privileged });
      if (!attemptRate.allowed) {
        logger.warn('query_submission_rate_limited', { sourceIp: ip, code: attemptRate.code, retryAfterMs: attemptRate.retryAfterMs });
        store.addServiceEvent('rate_limit', 'warning', attemptRate.code, '提交请求触发 IP 流控', { retryAfterMs: attemptRate.retryAfterMs }, { force: true });
        return json(response, 429, { error: { code: attemptRate.code, message: '提交请求过于频繁，请稍后重试', retryAfterMs: attemptRate.retryAfterMs } }, { 'retry-after': String(Math.ceil(attemptRate.retryAfterMs / 1000)) });
      }
      const deviceId = deviceIdentity(request, url, { privileged });
      let input;
      try { input = validateQueryPayload(payload); }
      catch (error) {
        logger.warn('query_validation_rejected', { sourceIp: ip, deviceId, code: error.code, message: error.message });
        throw error;
      }
      const rate = limiter.check({ ip, deviceId, privileged });
      if (!rate.allowed) {
        logger.warn('query_rate_limited', { sourceIp: ip, deviceId, code: rate.code, retryAfterMs: rate.retryAfterMs });
        store.addServiceEvent('rate_limit', 'warning', rate.code, '查询请求触发流控', { retryAfterMs: rate.retryAfterMs }, { force: true });
        return json(response, 429, { error: { code: rate.code, message: '请求过于频繁，请稍后重试', retryAfterMs: rate.retryAfterMs } }, { 'retry-after': String(Math.ceil(rate.retryAfterMs / 1000)) });
      }
      const source = privileged ? 'external_api' : 'public_web';
      const result = queue.enqueue(input, {
        requestId: String(payload.requestId || '').slice(0, 128) || null,
        source, sourceIp: ip, deviceId,
        userAgent: String(request.headers['user-agent'] || '').slice(0, 500)
      });
      void geoResolver.lookup(ip).then(geo => store.setQueryGeo(result.record.id, geo));
      return json(response, result.reused ? 200 : 202, { reused: result.reused, query: publicRecord(result.record, true), queue: queue.publicSnapshot(deviceId) });
    }
    if (request.method === 'GET' && staticFile(url.pathname, response)) return;
    json(response, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } });
  } catch (error) {
    logger.error('http_request_failed', { method: request.method, path: url.pathname, error: { code: error.code, message: error.message } });
    const headers = error.retryAfterMs ? { 'retry-after': String(Math.ceil(error.retryAfterMs / 1000)) } : {};
    json(response, error.statusCode || 500, {
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.statusCode ? error.message : '服务内部错误',
        ...(error.retryAfterMs ? { retryAfterMs: error.retryAfterMs } : {})
      }
    }, headers);
  }
});

function listen(port, host) {
  return new Promise((resolve, reject) => {
    const onError = error => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function startServer() {
  const maxAttempts = config.portAutoIncrement ? 10 : 1;
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = config.port + offset;
    try {
      await listen(port, config.host);
      boundPort = server.address()?.port || port;
      logger.info('server_started', { host: config.host, port: boundPort, preferredPort: config.port, url: config.publicBaseUrl || `http://127.0.0.1:${boundPort}` });
      store.addServiceEvent('server', 'operational', 'SERVER_STARTED', '查询服务已启动', { port: boundPort }, { force: true });
      return { port: boundPort, host: config.host };
    } catch (error) {
      if (error.code !== 'EADDRINUSE' || offset === maxAttempts - 1) {
        logger.error('server_start_failed', { port, error: { code: error.code, message: error.message } });
        throw error;
      }
      logger.warn('port_in_use_trying_next', { port, nextPort: port + 1 });
    }
  }
  throw new Error('没有可用端口');
}

export const serverReady = startServer();

let closing = false;
export async function prepareForCoreSwitch(timeoutMs = 180_000) {
  queue.beginMaintenance();
  logger.info('core_switch_drain_started', { queuedCount: queue.pending.length, running: Boolean(queue.currentId) });
  await queue.waitForIdle(timeoutMs);
  logger.info('core_switch_drain_completed', {});
}

export function cancelCoreSwitch() {
  queue.endMaintenance();
  logger.warn('core_switch_cancelled', {});
}

export async function shutdownServer(signal) {
  if (closing) return;
  closing = true;
  logger.info('server_stopping', { signal });
  store.addServiceEvent('server', 'offline', 'SERVER_STOPPED', '查询服务正在停止', { signal }, { force: true });
  clearInterval(heartbeatTimer);
  for (const client of clients) client.response.end();
  await new Promise(resolve => server.close(resolve));
  await driver.close();
  store.close();
}
if (!globalThis.__PPO_CORE_SHELL__) {
  process.on('SIGINT', () => shutdownServer('SIGINT').finally(() => process.exit(0)));
  process.on('SIGTERM', () => shutdownServer('SIGTERM').finally(() => process.exit(0)));
}
