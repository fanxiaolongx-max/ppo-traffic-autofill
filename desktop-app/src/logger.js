import fs from 'node:fs';
import path from 'node:path';

const SENSITIVE_KEYS = new Set(['documentNumber', 'passportNo', 'nationalId', 'rawPassportNo', 'cookie', 'authorization', 'apiKey', 'desktopToken']);

export function maskSensitive(value) {
  const text = String(value ?? '');
  if (text.length <= 4) return '*'.repeat(text.length);
  return `${text.slice(0, 2)}${'*'.repeat(Math.min(8, text.length - 4))}${text.slice(-2)}`;
}

function redact(value, key = '') {
  if (SENSITIVE_KEYS.has(key)) return maskSensitive(value);
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  }
  return value;
}

function localTimestamp(date = new Date()) {
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
    + `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
}

function normalizeSearch(value) {
  return String(value || '').toLowerCase().replace(/[•·]/g, '*').replace(/\s+/g, ' ').trim();
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (!value || typeof value.file !== 'string' || !Number.isInteger(value.line)) return null;
    return value;
  } catch {
    return null;
  }
}

export class AuditLogger {
  constructor(logDir) {
    this.logDir = logDir;
    fs.mkdirSync(logDir, { recursive: true });
  }

  cleanup(retentionDays) {
    const cutoff = Date.now() - retentionDays * 86_400_000;
    for (const name of fs.readdirSync(this.logDir)) {
      if (!/^audit-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue;
      const file = path.join(this.logDir, name);
      if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
    }
  }

  write(level, event, details = {}) {
    const now = new Date();
    const entry = {
      timestamp: now.toISOString(),
      localTimestamp: localTimestamp(now),
      level,
      event,
      ...redact(details)
    };
    const line = `${JSON.stringify(entry)}\n`;
    const file = path.join(this.logDir, `audit-${entry.timestamp.slice(0, 10)}.jsonl`);
    fs.appendFileSync(file, line, { encoding: 'utf8', mode: 0o600 });
    const output = level === 'error' ? console.error : console.log;
    output(line.trim());
  }

  recentPage(options = 200) {
    const input = typeof options === 'object' ? options : { limit: options };
    const safeLimit = Math.max(1, Math.min(2000, Number(input.limit) || 200));
    const query = normalizeSearch(input.query);
    const level = String(input.level || '').toLowerCase();
    const event = String(input.event || '').toLowerCase();
    const files = fs.readdirSync(this.logDir)
      .filter(name => /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
      .sort().reverse();
    const cursor = decodeCursor(input.cursor);
    const entries = [];
    let nextCursor = null;
    let cursorReached = !cursor;
    for (const name of files) {
      const lines = fs.readFileSync(path.join(this.logDir, name), 'utf8').split('\n').filter(Boolean);
      let startIndex = lines.length - 1;
      if (!cursorReached) {
        if (name !== cursor.file) continue;
        cursorReached = true;
        startIndex = Math.min(cursor.line, lines.length - 1);
      }
      for (let index = startIndex; index >= 0; index -= 1) {
        let entry;
        try { entry = JSON.parse(lines[index]); }
        catch { entry = { timestamp: '', localTimestamp: '', level: 'error', event: 'invalid_log_line', raw: lines[index].slice(0, 2000) }; }
        if (level && String(entry.level || '').toLowerCase() !== level) continue;
        if (event && !String(entry.event || '').toLowerCase().includes(event)) continue;
        if (query && !normalizeSearch(JSON.stringify(entry)).includes(query)) continue;
        if (entries.length >= safeLimit) {
          nextCursor = encodeCursor({ file: name, line: index });
          break;
        }
        entries.push(entry);
      }
      if (nextCursor) break;
    }
    return { items: entries, hasMore: Boolean(nextCursor), nextCursor };
  }

  recent(options = 200) {
    return this.recentPage(options).items;
  }

  info(event, details) { this.write('info', event, details); }
  warn(event, details) { this.write('warn', event, details); }
  error(event, details) { this.write('error', event, details); }
}
