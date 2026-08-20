import http from 'node:http';

const maintenanceHtml = ({ message, version }) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="5"><title>服务维护中 · Maintenance</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090d14;color:#eef3f8;font-family:Inter,system-ui,-apple-system,sans-serif;padding:24px}.card{width:min(560px,100%);padding:34px;border:1px solid #34445a;border-radius:22px;background:#111925;box-shadow:0 24px 70px #0008}.eyebrow{color:#e7bb45;font-weight:800;letter-spacing:.18em;font-size:12px}.pulse{width:12px;height:12px;border-radius:50%;display:inline-block;background:#e7bb45;box-shadow:0 0 0 0 #e7bb4588;animation:p 1.5s infinite;margin-right:10px}@keyframes p{70%{box-shadow:0 0 0 14px #e7bb4500}}h1{font-size:28px;margin:12px 0}p{color:#aebacc;line-height:1.7}.meta{font:13px ui-monospace,SFMono-Regular,monospace;color:#71e0c0}</style></head><body><main class="card"><div class="eyebrow">PPO QUERY HUB · MAINTENANCE</div><h1><span class="pulse"></span>服务正在平滑更新</h1><p>${escapeHtml(message || '正在排空查询队列并切换业务内核，请勿重复提交。页面会自动恢复。')}</p><p>Service update in progress. Existing work is protected and this page will refresh automatically.</p><div class="meta">target core ${escapeHtml(version || 'pending')}</div></main></body></html>`;

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function forwardedFor(request) {
  const address = request.socket.remoteAddress || '';
  const loopback = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
  const existing = loopback ? String(request.headers['x-forwarded-for'] || '').trim() : '';
  return existing || address;
}

export class StableGateway {
  constructor({ host = '0.0.0.0', port = 17654, autoIncrement = true, logger = console } = {}) {
    this.host = host;
    this.preferredPort = port;
    this.autoIncrement = autoIncrement;
    this.logger = logger;
    this.targetPort = null;
    this.maintenance = null;
    this.server = http.createServer((request, response) => this.handle(request, response));
    this.sockets = new Set();
    this.server.on('connection', socket => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
  }

  async listen() {
    const attempts = this.autoIncrement ? 10 : 1;
    for (let offset = 0; offset < attempts; offset += 1) {
      const port = this.preferredPort + offset;
      try {
        await new Promise((resolve, reject) => {
          const onError = error => { this.server.off('listening', onListening); reject(error); };
          const onListening = () => { this.server.off('error', onError); resolve(); };
          this.server.once('error', onError);
          this.server.once('listening', onListening);
          this.server.listen(port, this.host);
        });
        this.port = this.server.address().port;
        return { host: this.host, port: this.port };
      } catch (error) {
        if (error.code !== 'EADDRINUSE' || offset === attempts - 1) throw error;
      }
    }
    throw new Error('没有可用的公开服务端口');
  }

  setTarget(port) {
    this.targetPort = Number(port) || null;
    this.maintenance = null;
  }

  showMaintenance(details = {}) {
    this.maintenance = { startedAt: new Date().toISOString(), ...details };
    this.targetPort = null;
  }

  handle(request, response) {
    if (!this.targetPort) return this.respondMaintenance(request, response);
    const remoteAddress = request.socket.remoteAddress || '';
    const trustedLocalHop = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
    const headers = {
      ...request.headers,
      host: `127.0.0.1:${this.targetPort}`,
      'x-forwarded-for': forwardedFor(request),
      'x-forwarded-host': request.headers.host || '',
      'x-forwarded-proto': request.socket.encrypted ? 'https' : (trustedLocalHop ? (request.headers['x-forwarded-proto'] || 'http') : 'http')
    };
    if (!trustedLocalHop) {
      delete headers['cf-connecting-ip'];
      delete headers['true-client-ip'];
      delete headers['x-real-ip'];
    }
    const upstream = http.request({
      host: '127.0.0.1', port: this.targetPort, method: request.method,
      path: request.url, headers
    }, upstreamResponse => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.setTimeout(120_000, () => upstream.destroy(new Error('core gateway timeout')));
    upstream.on('error', error => {
      if (response.headersSent) return response.destroy(error);
      this.logger.warn?.('core_gateway_error', { error: { code: error.code, message: error.message } });
      this.respondMaintenance(request, response, '查询内核暂时不可用，正在自动恢复。');
    });
    request.on('aborted', () => upstream.destroy());
    request.pipe(upstream);
  }

  respondMaintenance(request, response, overrideMessage = '') {
    const details = this.maintenance || {};
    const message = overrideMessage || details.message || '正在排空查询队列并切换业务内核，请勿重复提交。页面会自动恢复。';
    response.setHeader('cache-control', 'no-store');
    response.setHeader('retry-after', '5');
    response.setHeader('x-content-type-options', 'nosniff');
    if (request.url?.startsWith('/api/')) {
      response.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        ok: false, maintenance: true,
        error: { code: 'CORE_MAINTENANCE', message, retryAfterMs: 5000 },
        update: details
      }));
      return;
    }
    response.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
    response.end(maintenanceHtml({ message, version: details.targetVersion }));
  }

  async close() {
    if (!this.server.listening) return;
    await new Promise(resolve => this.server.close(resolve));
    for (const socket of this.sockets) socket.destroy();
  }
}
