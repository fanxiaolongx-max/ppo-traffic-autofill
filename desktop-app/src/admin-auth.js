import crypto from 'node:crypto';

const COOKIE = 'ppo_admin_session';

function constantEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function derive(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export class AdminAuth {
  constructor({ store, config, logger }) {
    this.store = store;
    this.config = config;
    this.logger = logger;
    this.sessions = new Map();
    this.attempts = new Map();
    if (config.adminPassword && !this.hasPassword()) this.setPassword(config.adminPassword, { initializedFromEnvironment: true });
  }

  hasPassword() { return Boolean(this.store.getSetting('admin_password_v1')?.hash); }

  verifyPassword(password) {
    const credential = this.store.getSetting('admin_password_v1');
    if (!credential?.salt || !credential?.hash || typeof password !== 'string') return false;
    return constantEqual(derive(password, credential.salt), credential.hash);
  }

  setPassword(password, { initializedFromEnvironment = false } = {}) {
    if (typeof password !== 'string' || password.length < 9 || password.length > 128) {
      throw Object.assign(new Error('管理员密码长度应为 9～128 个字符'), { statusCode: 422, code: 'INVALID_ADMIN_PASSWORD' });
    }
    const salt = crypto.randomBytes(24).toString('hex');
    this.store.setSetting('admin_password_v1', { salt, hash: derive(password, salt) });
    this.sessions.clear();
    this.logger.info('admin_password_updated', { initializedFromEnvironment });
  }

  checkLoginRate(ip) {
    const now = Date.now();
    const prior = (this.attempts.get(ip) || []).filter(time => now - time < this.config.adminLoginWindowMs);
    this.attempts.set(ip, prior);
    if (prior.length >= this.config.adminLoginAttempts) {
      return { allowed: false, retryAfterMs: this.config.adminLoginWindowMs - (now - prior[0]) };
    }
    return { allowed: true };
  }

  recordFailure(ip) {
    const times = this.attempts.get(ip) || [];
    times.push(Date.now());
    this.attempts.set(ip, times);
  }

  createSession({ ip, userAgent }) {
    const token = crypto.randomBytes(32).toString('base64url');
    const session = {
      token,
      csrfToken: crypto.randomBytes(24).toString('base64url'),
      ip,
      userAgent,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.config.adminSessionHours * 3_600_000
    };
    this.sessions.set(token, session);
    this.attempts.delete(ip);
    return session;
  }

  tokenFromRequest(request) {
    const cookies = String(request.headers.cookie || '').split(';');
    for (const cookie of cookies) {
      const [name, ...value] = cookie.trim().split('=');
      if (name === COOKIE) return decodeURIComponent(value.join('='));
    }
    return '';
  }

  session(request) {
    const token = this.tokenFromRequest(request);
    const session = this.sessions.get(token);
    if (!session) return null;
    if (Date.now() >= session.expiresAt) { this.sessions.delete(token); return null; }
    return session;
  }

  invalidate(request) { this.sessions.delete(this.tokenFromRequest(request)); }

  assertCsrf(request, context) {
    if (context.desktop) return;
    if (!constantEqual(request.headers['x-csrf-token'], context.session?.csrfToken)) {
      throw Object.assign(new Error('安全校验失败，请刷新管理页面后重试'), { statusCode: 403, code: 'CSRF_INVALID' });
    }
  }

  sessionCookie(session, secure = false) {
    const maxAge = Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000));
    return `${COOKIE}=${encodeURIComponent(session.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }

  clearCookie(secure = false) {
    return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
  }
}
