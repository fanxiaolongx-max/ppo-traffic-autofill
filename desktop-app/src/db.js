import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeCursor(cursor, type) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (!value || value.type !== type) return null;
    return value;
  } catch {
    return null;
  }
}

function normalizedSearch(value) {
  return String(value || '').toLowerCase().replace(/[•·]/g, '*').replace(/\s+/g, ' ').trim();
}

function maskedDocument(value) {
  const text = String(value || '');
  return text.length > 4 ? `${text.slice(0, 2)}${'*'.repeat(Math.min(8, text.length - 4))}${text.slice(-2)}` : '*'.repeat(text.length);
}

function querySearchText(row) {
  const request = typeof row.request_json === 'string' ? JSON.parse(row.request_json || '{}') : (row.request || {});
  const geo = typeof row.geo_json === 'string' ? JSON.parse(row.geo_json || '{}') : (row.geo || {});
  const document = String(request.documentNumber || '');
  const plate = `${[request.letter1, request.letter2, request.letter3].filter(Boolean).join(' ')} ${request.plateNumber || ''}`.trim();
  return normalizedSearch([
    row.id, row.trace_id || row.traceId, row.request_id || row.requestId, row.source, row.status,
    plate, document, maskedDocument(document), row.source_ip || row.sourceIp, row.device_id || row.deviceId,
    row.user_agent || row.userAgent, geo.country, geo.region, geo.city, geo.isp
  ].filter(Boolean).join(' '));
}

function feedbackSearchText(row) {
  const geo = typeof row.geo_json === 'string' ? JSON.parse(row.geo_json || '{}') : (row.geo || {});
  return normalizedSearch([
    row.id, row.device_id || row.deviceId, row.source_ip || row.sourceIp, row.phone, row.wechat,
    row.content, row.admin_note || row.adminNote, row.user_agent || row.userAgent,
    geo.country, geo.region, geo.city, geo.isp
  ].filter(Boolean).join(' '));
}

export class Store {
  constructor(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'ppo-query-hub.sqlite'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS queries (
        id TEXT PRIMARY KEY,
        request_id TEXT,
        trace_id TEXT NOT NULL UNIQUE,
        fingerprint TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        step TEXT NOT NULL,
        detail TEXT,
        source TEXT NOT NULL,
        source_ip TEXT,
        device_id TEXT,
        user_agent TEXT,
        geo_json TEXT,
        search_text TEXT NOT NULL DEFAULT '',
        request_json TEXT NOT NULL,
        result_json TEXT,
        error_json TEXT,
        attempt INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        queued_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_queries_created ON queries(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_queries_fingerprint ON queries(fingerprint, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_queries_status ON queries(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_queries_page ON queries(created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_queries_status_page ON queries(status, created_at DESC, id DESC);
      CREATE TABLE IF NOT EXISTS query_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_id TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        event TEXT NOT NULL,
        status TEXT,
        step TEXT,
        progress INTEGER,
        details_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(query_id) REFERENCES queries(id)
      );
      CREATE INDEX IF NOT EXISTS idx_events_query ON query_events(query_id, id);
      CREATE TABLE IF NOT EXISTS service_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        component TEXT NOT NULL,
        status TEXT NOT NULL,
        code TEXT,
        message TEXT NOT NULL,
        details_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_service_events_created ON service_events(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_service_events_component ON service_events(component, created_at DESC);
      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        source_ip TEXT,
        user_agent TEXT,
        geo_json TEXT,
        phone TEXT,
        wechat TEXT,
        content TEXT NOT NULL,
        page_url TEXT,
        attachments_json TEXT,
        search_text TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'new',
        admin_note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_feedback_page ON feedback(created_at DESC, id DESC);
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sms_deliveries (
        id TEXT PRIMARY KEY,
        query_id TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        rule_id TEXT NOT NULL,
        match_type TEXT NOT NULL,
        match_value TEXT NOT NULL,
        recipient TEXT NOT NULL,
        message_text TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        api_url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        provider_message_id TEXT,
        provider_status TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(query_id, rule_id),
        FOREIGN KEY(query_id) REFERENCES queries(id)
      );
      CREATE INDEX IF NOT EXISTS idx_sms_deliveries_page ON sms_deliveries(created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_sms_deliveries_status ON sms_deliveries(status, created_at);
      CREATE TABLE IF NOT EXISTS sms_user_bindings (
        id TEXT PRIMARY KEY,
        query_fingerprint TEXT NOT NULL,
        query_id TEXT NOT NULL,
        recipient TEXT NOT NULL,
        device_id TEXT NOT NULL,
        source_ip TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        code_salt TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        verify_attempts INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT NOT NULL,
        resend_after TEXT NOT NULL,
        created_at TEXT NOT NULL,
        verified_at TEXT,
        interval_hours INTEGER NOT NULL DEFAULT 168,
        next_run_at TEXT,
        last_run_at TEXT,
        last_query_id TEXT,
        schedule_claimed_until TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(query_id) REFERENCES queries(id)
      );
      CREATE INDEX IF NOT EXISTS idx_sms_bindings_query ON sms_user_bindings(query_fingerprint, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sms_bindings_identity ON sms_user_bindings(device_id, source_ip, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sms_bindings_phone ON sms_user_bindings(recipient, verified_at DESC);
      CREATE TABLE IF NOT EXISTS ip_geo_cache (
        ip TEXT PRIMARY KEY,
        geo_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const columns = new Set(this.db.prepare('PRAGMA table_info(queries)').all().map(column => column.name));
    if (!columns.has('detail')) this.db.exec('ALTER TABLE queries ADD COLUMN detail TEXT');
    if (!columns.has('geo_json')) this.db.exec('ALTER TABLE queries ADD COLUMN geo_json TEXT');
    if (!columns.has('search_text')) this.db.exec("ALTER TABLE queries ADD COLUMN search_text TEXT NOT NULL DEFAULT ''");
    const feedbackColumns = new Set(this.db.prepare('PRAGMA table_info(feedback)').all().map(column => column.name));
    if (!feedbackColumns.has('attachments_json')) this.db.exec('ALTER TABLE feedback ADD COLUMN attachments_json TEXT');
    if (!feedbackColumns.has('search_text')) this.db.exec("ALTER TABLE feedback ADD COLUMN search_text TEXT NOT NULL DEFAULT ''");
    const bindingColumns = new Set(this.db.prepare('PRAGMA table_info(sms_user_bindings)').all().map(column => column.name));
    if (!bindingColumns.has('interval_hours')) this.db.exec('ALTER TABLE sms_user_bindings ADD COLUMN interval_hours INTEGER NOT NULL DEFAULT 168');
    if (!bindingColumns.has('next_run_at')) this.db.exec('ALTER TABLE sms_user_bindings ADD COLUMN next_run_at TEXT');
    if (!bindingColumns.has('last_run_at')) this.db.exec('ALTER TABLE sms_user_bindings ADD COLUMN last_run_at TEXT');
    if (!bindingColumns.has('last_query_id')) this.db.exec('ALTER TABLE sms_user_bindings ADD COLUMN last_query_id TEXT');
    if (!bindingColumns.has('schedule_claimed_until')) this.db.exec('ALTER TABLE sms_user_bindings ADD COLUMN schedule_claimed_until TEXT');
    this.db.prepare("UPDATE sms_user_bindings SET next_run_at=? WHERE status='verified' AND next_run_at IS NULL")
      .run(new Date(Date.now() + 168 * 3_600_000).toISOString());
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sms_bindings_due ON sms_user_bindings(status, next_run_at)');
    this.rebuildSearchText();
    this.db.prepare("UPDATE queries SET status='interrupted', step='process_restarted', finished_at=?, updated_at=? WHERE status='running'")
      .run(new Date().toISOString(), new Date().toISOString());
    this.db.prepare("UPDATE sms_deliveries SET status='queued', updated_at=? WHERE status='sending'").run(new Date().toISOString());
  }

  rebuildSearchText() {
    const queryRows = this.db.prepare("SELECT * FROM queries WHERE search_text='' OR search_text IS NULL").all();
    const feedbackRows = this.db.prepare("SELECT * FROM feedback WHERE search_text='' OR search_text IS NULL").all();
    if (!queryRows.length && !feedbackRows.length) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const updateQuery = this.db.prepare('UPDATE queries SET search_text=? WHERE id=?');
      for (const row of queryRows) updateQuery.run(querySearchText(row), row.id);
      const updateFeedback = this.db.prepare('UPDATE feedback SET search_text=? WHERE id=?');
      for (const row of feedbackRows) updateFeedback.run(feedbackSearchText(row), row.id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  setQueryGeo(id, geo) {
    this.db.prepare('UPDATE queries SET geo_json=?, updated_at=? WHERE id=?').run(JSON.stringify(geo || {}), new Date().toISOString(), id);
    const row = this.db.prepare('SELECT * FROM queries WHERE id=?').get(id);
    if (row) this.db.prepare('UPDATE queries SET search_text=? WHERE id=?').run(querySearchText(row), id);
    return this.getQuery(id);
  }

  createQuery(record) {
    this.db.prepare(`INSERT INTO queries (
      id, request_id, trace_id, fingerprint, status, progress, step, source, source_ip,
      device_id, user_agent, search_text, request_json, attempt, created_at, queued_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      record.id, record.requestId, record.traceId, record.fingerprint, record.status,
      record.progress, record.step, record.source, record.sourceIp, record.deviceId,
      record.userAgent, querySearchText(record), JSON.stringify(record.request), 0, record.createdAt,
      record.createdAt, record.createdAt
    );
    this.addEvent(record.id, record.traceId, 'query_created', record);
    return this.getQuery(record.id);
  }

  updateQuery(id, patch) {
    const allowed = {
      status: 'status', progress: 'progress', step: 'step', detail: 'detail', result: 'result_json',
      error: 'error_json', attempt: 'attempt', startedAt: 'started_at', finishedAt: 'finished_at'
    };
    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(allowed)) {
      if (patch[key] !== undefined) {
        sets.push(`${column}=?`);
        values.push(key === 'result' || key === 'error' ? JSON.stringify(patch[key]) : patch[key]);
      }
    }
    sets.push('updated_at=?');
    values.push(new Date().toISOString(), id);
    this.db.prepare(`UPDATE queries SET ${sets.join(', ')} WHERE id=?`).run(...values);
    if (patch.status !== undefined) {
      const row = this.db.prepare('SELECT * FROM queries WHERE id=?').get(id);
      if (row) this.db.prepare('UPDATE queries SET search_text=? WHERE id=?').run(querySearchText(row), id);
    }
    const record = this.getQuery(id);
    if (record) this.addEvent(id, record.traceId, 'query_updated', patch);
    return record;
  }

  addEvent(queryId, traceId, event, details = {}) {
    this.db.prepare(`INSERT INTO query_events
      (query_id, trace_id, event, status, step, progress, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      queryId, traceId, event, details.status || null, details.step || null,
      details.progress ?? null, JSON.stringify(details), new Date().toISOString()
    );
  }

  getQuery(id) {
    return this.map(this.db.prepare('SELECT * FROM queries WHERE id=?').get(id));
  }

  getByRequestId(requestId, deviceId) {
    if (!requestId) return null;
    return this.map(this.db.prepare('SELECT * FROM queries WHERE request_id=? AND device_id=? ORDER BY created_at DESC LIMIT 1').get(requestId, deviceId));
  }

  findRecentFingerprint(fingerprint, sinceIso, deviceId) {
    return this.map(this.db.prepare(`SELECT * FROM queries WHERE fingerprint=? AND created_at>=?
      AND device_id=? AND status IN ('queued','running','success') ORDER BY created_at DESC LIMIT 1`).get(fingerprint, sinceIso, deviceId));
  }

  list(limit = 100, statuses = [], offset = 0) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const safeOffset = Math.max(0, Number(offset) || 0);
    if (statuses.length) {
      const marks = statuses.map(() => '?').join(',');
      return this.db.prepare(`SELECT * FROM queries WHERE status IN (${marks}) ORDER BY created_at DESC LIMIT ? OFFSET ?`)
        .all(...statuses, safeLimit, safeOffset).map(row => this.map(row));
    }
    return this.db.prepare('SELECT * FROM queries ORDER BY created_at DESC LIMIT ? OFFSET ?').all(safeLimit, safeOffset).map(row => this.map(row));
  }

  listByDevice(deviceId, limit = 100, statuses = [], offset = 0) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const safeOffset = Math.max(0, Number(offset) || 0);
    if (statuses.length) {
      const marks = statuses.map(() => '?').join(',');
      return this.db.prepare(`SELECT * FROM queries WHERE device_id=? AND status IN (${marks}) ORDER BY created_at DESC LIMIT ? OFFSET ?`)
        .all(deviceId, ...statuses, safeLimit, safeOffset).map(row => this.map(row));
    }
    return this.db.prepare('SELECT * FROM queries WHERE device_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(deviceId, safeLimit, safeOffset).map(row => this.map(row));
  }

  listPage({ deviceId = '', privileged = false, limit = 20, cursor = '', offset = 0 } = {}) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const decodedCursor = decodeCursor(cursor, 'history');
    const conditions = [];
    const parameters = [];
    if (!privileged) { conditions.push('device_id=?'); parameters.push(deviceId); }
    if (decodedCursor?.createdAt && decodedCursor?.id) {
      conditions.push('(created_at<? OR (created_at=? AND id<?))');
      parameters.push(decodedCursor.createdAt, decodedCursor.createdAt, decodedCursor.id);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM queries ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...parameters, safeLimit + 1, decodedCursor ? 0 : safeOffset);
    const hasMore = rows.length > safeLimit;
    const pageRows = rows.slice(0, safeLimit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(row => this.map(row)), hasMore, limit: safeLimit,
      nextCursor: hasMore && last ? encodeCursor({ type: 'history', createdAt: last.created_at, id: last.id }) : null
    };
  }

  listEvents(id) {
    return this.db.prepare('SELECT * FROM query_events WHERE query_id=? ORDER BY id ASC').all(id).map(row => ({
      id: row.id,
      event: row.event,
      status: row.status,
      step: row.step,
      progress: row.progress,
      details: JSON.parse(row.details_json || '{}'),
      createdAt: row.created_at
    }));
  }

  addServiceEvent(component, status, code, message, details = {}, { force = false } = {}) {
    if (!force) {
      const latest = this.db.prepare('SELECT status, code FROM service_events WHERE component=? ORDER BY id DESC LIMIT 1').get(component);
      if (latest?.status === status && latest?.code === code) return null;
    }
    const createdAt = new Date().toISOString();
    const result = this.db.prepare(`INSERT INTO service_events
      (component, status, code, message, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(component, status, code || null, message, JSON.stringify(details || {}), createdAt);
    return { id: Number(result.lastInsertRowid), component, status, code: code || null, message, details: details || {}, createdAt };
  }

  listServiceEventsPage({ limit = 50, cursor = '', offset = 0, sinceIso = '', components = [] } = {}) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const decodedCursor = decodeCursor(cursor, 'service');
    const safeComponents = [...new Set(components.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 20);
    const conditions = [];
    const parameters = [];
    if (sinceIso) { conditions.push('created_at>=?'); parameters.push(sinceIso); }
    if (safeComponents.length) {
      conditions.push(`component IN (${safeComponents.map(() => '?').join(',')})`);
      parameters.push(...safeComponents);
    }
    const countWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM service_events ${countWhere}`).get(...parameters)?.count || 0);
    if (decodedCursor?.id) { conditions.push('id<?'); parameters.push(Number(decodedCursor.id)); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM service_events ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...parameters, safeLimit + 1, decodedCursor ? 0 : safeOffset);
    const hasMore = rows.length > safeLimit;
    const items = rows.slice(0, safeLimit).map(row => ({
      id: row.id, component: row.component, status: row.status, code: row.code,
      message: row.message, details: JSON.parse(row.details_json || '{}'), createdAt: row.created_at
    }));
    const last = items.at(-1);
    return {
      items, total, limit: safeLimit, offset: decodedCursor ? null : safeOffset, hasMore,
      nextOffset: hasMore && !decodedCursor ? safeOffset + items.length : null,
      nextCursor: hasMore && last ? encodeCursor({ type: 'service', id: last.id }) : null
    };
  }

  listServiceEvents(limit = 50, sinceIso = '') {
    return this.listServiceEventsPage({ limit, sinceIso }).items;
  }

  countServiceEvents(component, sinceIso, codes = []) {
    if (codes.length) {
      const marks = codes.map(() => '?').join(',');
      return Number(this.db.prepare(`SELECT COUNT(*) AS count FROM service_events WHERE component=? AND created_at>=? AND code IN (${marks})`)
        .get(component, sinceIso, ...codes)?.count || 0);
    }
    return Number(this.db.prepare('SELECT COUNT(*) AS count FROM service_events WHERE component=? AND created_at>=?')
      .get(component, sinceIso)?.count || 0);
  }

  queryStatistics(sinceIso) {
    const counts = Object.fromEntries(this.db.prepare('SELECT status, COUNT(*) AS count FROM queries WHERE created_at>=? GROUP BY status')
      .all(sinceIso).map(row => [row.status, Number(row.count)]));
    const success = counts.success || 0;
    const failed = counts.failed || 0;
    const terminal = success + failed;
    const lastSuccess = this.db.prepare("SELECT finished_at FROM queries WHERE status='success' ORDER BY finished_at DESC LIMIT 1").get()?.finished_at || null;
    const lastFailure = this.db.prepare("SELECT finished_at, error_json FROM queries WHERE status='failed' ORDER BY finished_at DESC LIMIT 1").get();
    return {
      counts,
      total: Object.values(counts).reduce((sum, value) => sum + value, 0),
      terminal,
      success,
      failed,
      successRate: terminal ? Math.round((success / terminal) * 10_000) / 100 : null,
      lastSuccessAt: lastSuccess,
      lastFailureAt: lastFailure?.finished_at || null,
      lastFailureCode: lastFailure?.error_json ? JSON.parse(lastFailure.error_json).code || null : null
    };
  }

  searchQueries({ query = '', status = '', limit = 50, cursor = '', offset = 0 } = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const decodedCursor = decodeCursor(cursor, 'query');
    const conditions = [];
    const parameters = [];
    if (status) { conditions.push('status=?'); parameters.push(status); }
    const needle = normalizedSearch(query);
    if (needle) { conditions.push("search_text LIKE ? ESCAPE '\\'"); parameters.push(`%${needle.replace(/[\\%_]/g, '\\$&')}%`); }
    const countWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM queries ${countWhere}`).get(...parameters)?.count || 0);
    if (decodedCursor?.createdAt && decodedCursor?.id) {
      conditions.push('(created_at<? OR (created_at=? AND id<?))');
      parameters.push(decodedCursor.createdAt, decodedCursor.createdAt, decodedCursor.id);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM queries ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...parameters, safeLimit + 1, decodedCursor ? 0 : safeOffset);
    const hasMore = rows.length > safeLimit;
    const pageRows = rows.slice(0, safeLimit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(row => this.map(row)), total, hasMore,
      nextCursor: hasMore && last ? encodeCursor({ type: 'query', createdAt: last.created_at, id: last.id }) : null
    };
  }

  createFeedback(record) {
    this.db.prepare(`INSERT INTO feedback
      (id, device_id, source_ip, user_agent, geo_json, phone, wechat, content, page_url, attachments_json, search_text, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`).run(
      record.id, record.deviceId, record.sourceIp, record.userAgent, record.geo ? JSON.stringify(record.geo) : null,
      record.phone || null, record.wechat || null, record.content, record.pageUrl || null,
      record.attachments?.length ? JSON.stringify(record.attachments) : null, feedbackSearchText(record), record.createdAt, record.createdAt
    );
    return this.getFeedback(record.id);
  }

  getFeedback(id) {
    const row = this.db.prepare('SELECT * FROM feedback WHERE id=?').get(id);
    return this.mapFeedback(row);
  }

  setFeedbackGeo(id, geo) {
    this.db.prepare('UPDATE feedback SET geo_json=?, updated_at=? WHERE id=?').run(JSON.stringify(geo || {}), new Date().toISOString(), id);
    const row = this.db.prepare('SELECT * FROM feedback WHERE id=?').get(id);
    if (row) this.db.prepare('UPDATE feedback SET search_text=? WHERE id=?').run(feedbackSearchText(row), id);
    return this.getFeedback(id);
  }

  updateFeedback(id, patch) {
    const sets = [];
    const values = [];
    if (patch.status !== undefined) { sets.push('status=?'); values.push(patch.status); }
    if (patch.adminNote !== undefined) { sets.push('admin_note=?'); values.push(patch.adminNote || null); }
    if (!sets.length) return this.getFeedback(id);
    sets.push('updated_at=?'); values.push(new Date().toISOString(), id);
    this.db.prepare(`UPDATE feedback SET ${sets.join(', ')} WHERE id=?`).run(...values);
    const row = this.db.prepare('SELECT * FROM feedback WHERE id=?').get(id);
    if (row) this.db.prepare('UPDATE feedback SET search_text=? WHERE id=?').run(feedbackSearchText(row), id);
    return this.getFeedback(id);
  }

  listFeedback({ query = '', status = '', limit = 50, cursor = '', offset = 0 } = {}) {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const decodedCursor = decodeCursor(cursor, 'feedback');
    const conditions = [];
    const parameters = [];
    if (status) { conditions.push('status=?'); parameters.push(status); }
    const needle = normalizedSearch(query);
    if (needle) { conditions.push("search_text LIKE ? ESCAPE '\\'"); parameters.push(`%${needle.replace(/[\\%_]/g, '\\$&')}%`); }
    const countWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM feedback ${countWhere}`).get(...parameters)?.count || 0);
    if (decodedCursor?.createdAt && decodedCursor?.id) {
      conditions.push('(created_at<? OR (created_at=? AND id<?))');
      parameters.push(decodedCursor.createdAt, decodedCursor.createdAt, decodedCursor.id);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM feedback ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...parameters, safeLimit + 1, decodedCursor ? 0 : safeOffset);
    const hasMore = rows.length > safeLimit;
    const pageRows = rows.slice(0, safeLimit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(row => this.mapFeedback(row)), total, hasMore,
      nextCursor: hasMore && last ? encodeCursor({ type: 'feedback', createdAt: last.created_at, id: last.id }) : null
    };
  }

  feedbackStatistics() {
    const counts = Object.fromEntries(this.db.prepare('SELECT status, COUNT(*) AS count FROM feedback GROUP BY status').all().map(row => [row.status, Number(row.count)]));
    return { counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0), unread: counts.new || 0 };
  }

  getSetting(key) {
    const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key=?').get(key);
    if (!row) return null;
    try { return JSON.parse(row.value_json); } catch { return null; }
  }

  setSetting(key, value) {
    this.db.prepare(`INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`)
      .run(key, JSON.stringify(value), new Date().toISOString());
  }

  createSmsDelivery(value) {
    const now = new Date().toISOString();
    const result = this.db.prepare(`INSERT OR IGNORE INTO sms_deliveries (
      id, query_id, trace_id, rule_id, match_type, match_value, recipient, message_text,
      idempotency_key, api_url, status, attempts, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`).run(
      value.id, value.queryId, value.traceId, value.ruleId, value.matchType, value.matchValue,
      value.to, value.text, value.idempotencyKey, value.apiUrl, now, now
    );
    return result.changes ? this.getSmsDelivery(value.id) : null;
  }

  getSmsDelivery(id) {
    return this.mapSmsDelivery(this.db.prepare('SELECT * FROM sms_deliveries WHERE id=?').get(id));
  }

  nextSmsDelivery() {
    return this.mapSmsDelivery(this.db.prepare("SELECT * FROM sms_deliveries WHERE status='queued' ORDER BY created_at, id LIMIT 1").get());
  }

  updateSmsDelivery(id, patch) {
    const fields = [];
    const values = [];
    const columns = { status: 'status', attempts: 'attempts', providerMessageId: 'provider_message_id', providerStatus: 'provider_status', error: 'error' };
    for (const [key, column] of Object.entries(columns)) {
      if (patch[key] !== undefined) { fields.push(`${column}=?`); values.push(patch[key] || (key === 'attempts' ? 0 : null)); }
    }
    if (!fields.length) return this.getSmsDelivery(id);
    fields.push('updated_at=?'); values.push(new Date().toISOString(), id);
    this.db.prepare(`UPDATE sms_deliveries SET ${fields.join(', ')} WHERE id=?`).run(...values);
    return this.getSmsDelivery(id);
  }

  listSmsDeliveries({ limit = 20, cursor = '' } = {}) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const decoded = decodeCursor(cursor, 'sms');
    const conditions = [];
    const values = [];
    if (decoded?.createdAt && decoded?.id) {
      conditions.push('(created_at<? OR (created_at=? AND id<?))');
      values.push(decoded.createdAt, decoded.createdAt, decoded.id);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM sms_deliveries ${where} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...values, safeLimit + 1);
    const hasMore = rows.length > safeLimit;
    const page = rows.slice(0, safeLimit);
    const last = page.at(-1);
    const total = Number(this.db.prepare('SELECT COUNT(*) AS count FROM sms_deliveries').get()?.count || 0);
    return { items: page.map(row => this.mapSmsDelivery(row)), total, hasMore, nextCursor: hasMore && last ? encodeCursor({ type: 'sms', createdAt: last.created_at, id: last.id }) : null };
  }

  createSmsBinding(value) {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE sms_user_bindings SET status='superseded', updated_at=? WHERE query_fingerprint=? AND device_id=? AND source_ip=? AND status='pending'")
      .run(now, value.queryFingerprint, value.deviceId, value.sourceIp);
    this.db.prepare(`INSERT INTO sms_user_bindings (
      id, query_fingerprint, query_id, recipient, device_id, source_ip, status,
      code_salt, code_hash, verify_attempts, expires_at, resend_after, interval_hours, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, 0, ?, ?, ?, ?, ?)`).run(
      value.id, value.queryFingerprint, value.queryId, value.to, value.deviceId, value.sourceIp,
      value.codeSalt, value.codeHash, value.expiresAt, value.resendAfter, value.intervalHours, now, now
    );
    return this.getSmsBinding(value.id);
  }

  getSmsBinding(id) {
    return this.mapSmsBinding(this.db.prepare('SELECT * FROM sms_user_bindings WHERE id=?').get(id));
  }

  latestSmsBinding(queryFingerprint, deviceId, sourceIp) {
    return this.mapSmsBinding(this.db.prepare(`SELECT * FROM sms_user_bindings
      WHERE query_fingerprint=? AND device_id=? AND source_ip=?
      ORDER BY created_at DESC LIMIT 1`).get(queryFingerprint, deviceId, sourceIp));
  }

  verifiedSmsBinding(queryFingerprint, recipient = '') {
    const row = recipient
      ? this.db.prepare("SELECT * FROM sms_user_bindings WHERE query_fingerprint=? AND recipient=? AND status='verified' ORDER BY verified_at DESC LIMIT 1").get(queryFingerprint, recipient)
      : this.db.prepare("SELECT * FROM sms_user_bindings WHERE query_fingerprint=? AND status='verified' ORDER BY verified_at DESC LIMIT 1").get(queryFingerprint);
    return this.mapSmsBinding(row);
  }

  verifiedSmsBindingForDevice(queryFingerprint, deviceId, recipient = '') {
    const row = recipient
      ? this.db.prepare("SELECT * FROM sms_user_bindings WHERE query_fingerprint=? AND device_id=? AND recipient=? AND status='verified' ORDER BY verified_at DESC LIMIT 1").get(queryFingerprint, deviceId, recipient)
      : this.db.prepare("SELECT * FROM sms_user_bindings WHERE query_fingerprint=? AND device_id=? AND status='verified' ORDER BY verified_at DESC LIMIT 1").get(queryFingerprint, deviceId);
    return this.mapSmsBinding(row);
  }

  listVerifiedSmsBindings(queryFingerprint) {
    return this.db.prepare(`SELECT * FROM sms_user_bindings WHERE query_fingerprint=? AND status='verified'
      GROUP BY recipient ORDER BY verified_at DESC`).all(queryFingerprint).map(row => this.mapSmsBinding(row));
  }

  smsBindingUsage({ deviceId, sourceIp, recipient, sinceIso }) {
    const identity = this.db.prepare(`SELECT COUNT(*) AS requests, COUNT(DISTINCT recipient) AS phones
      FROM sms_user_bindings WHERE device_id=? AND source_ip=? AND created_at>=?`).get(deviceId, sourceIp, sinceIso);
    const phone = this.db.prepare(`SELECT COUNT(DISTINCT query_fingerprint) AS queries FROM sms_user_bindings
      WHERE recipient=? AND status='verified' AND verified_at>=?`).get(recipient, sinceIso);
    const phoneSeen = this.db.prepare(`SELECT 1 AS seen FROM sms_user_bindings
      WHERE device_id=? AND source_ip=? AND recipient=? AND created_at>=? LIMIT 1`).get(deviceId, sourceIp, recipient, sinceIso);
    return { requests: Number(identity?.requests || 0), phones: Number(identity?.phones || 0), queries: Number(phone?.queries || 0), phoneSeen: Boolean(phoneSeen) };
  }

  recordSmsBindingFailure(id) {
    this.db.prepare('UPDATE sms_user_bindings SET verify_attempts=verify_attempts+1, updated_at=? WHERE id=?')
      .run(new Date().toISOString(), id);
    return this.getSmsBinding(id);
  }

  verifySmsBinding(id) {
    const binding = this.getSmsBinding(id);
    if (!binding) return null;
    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare("UPDATE sms_user_bindings SET status='replaced', updated_at=? WHERE query_fingerprint=? AND device_id=? AND status='verified' AND id<>?")
        .run(now, binding.queryFingerprint, binding.deviceId, id);
      const nextRunAt = new Date(Date.now() + binding.intervalHours * 3_600_000).toISOString();
      this.db.prepare("UPDATE sms_user_bindings SET status='verified', code_salt='', code_hash='', verified_at=?, next_run_at=?, schedule_claimed_until=NULL, updated_at=? WHERE id=?")
        .run(now, nextRunAt, now, id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.getSmsBinding(id);
  }

  updateSmsBindingSchedule(id, intervalHours) {
    const now = new Date().toISOString();
    const nextRunAt = new Date(Date.now() + intervalHours * 3_600_000).toISOString();
    this.db.prepare("UPDATE sms_user_bindings SET interval_hours=?, next_run_at=?, schedule_claimed_until=NULL, updated_at=? WHERE id=? AND status='verified'")
      .run(intervalHours, nextRunAt, now, id);
    return this.getSmsBinding(id);
  }

  claimDueSmsSchedule(nowIso, claimedUntilIso) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare(`SELECT * FROM sms_user_bindings
        WHERE status='verified' AND next_run_at IS NOT NULL AND next_run_at<=?
        AND (schedule_claimed_until IS NULL OR schedule_claimed_until<=?)
        ORDER BY next_run_at, id LIMIT 1`).get(nowIso, nowIso);
      if (!row) { this.db.exec('COMMIT'); return null; }
      this.db.prepare('UPDATE sms_user_bindings SET schedule_claimed_until=?, updated_at=? WHERE id=?')
        .run(claimedUntilIso, nowIso, row.id);
      this.db.exec('COMMIT');
      return this.getSmsBinding(row.id);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  completeSmsSchedule(id, { queryId, nextRunAt, runAt }) {
    this.db.prepare(`UPDATE sms_user_bindings SET last_query_id=?, last_run_at=?, next_run_at=?,
      schedule_claimed_until=NULL, updated_at=? WHERE id=?`).run(queryId, runAt, nextRunAt, runAt, id);
    return this.getSmsBinding(id);
  }

  deferSmsSchedule(id, nextRunAt) {
    this.db.prepare('UPDATE sms_user_bindings SET next_run_at=?, schedule_claimed_until=NULL, updated_at=? WHERE id=?')
      .run(nextRunAt, new Date().toISOString(), id);
    return this.getSmsBinding(id);
  }

  smsBindingByLastQueryId(queryId) {
    return this.mapSmsBinding(this.db.prepare("SELECT * FROM sms_user_bindings WHERE last_query_id=? AND status='verified' ORDER BY updated_at DESC LIMIT 1").get(queryId));
  }

  close() {
    this.db.close();
  }

  getIpGeo(ip, cacheDays) {
    const row = this.db.prepare('SELECT geo_json, updated_at FROM ip_geo_cache WHERE ip=?').get(ip);
    if (!row || Date.now() - new Date(row.updated_at).getTime() > cacheDays * 86_400_000) return null;
    try { return JSON.parse(row.geo_json); } catch { return null; }
  }

  setIpGeo(ip, geo) {
    this.db.prepare(`INSERT INTO ip_geo_cache (ip, geo_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(ip) DO UPDATE SET geo_json=excluded.geo_json, updated_at=excluded.updated_at`)
      .run(ip, JSON.stringify(geo), new Date().toISOString());
  }

  cleanupServiceEvents(retentionDays) {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    this.db.prepare('DELETE FROM service_events WHERE created_at<?').run(cutoff);
  }

  map(row) {
    if (!row) return null;
    return {
      id: row.id,
      requestId: row.request_id,
      traceId: row.trace_id,
      fingerprint: row.fingerprint,
      status: row.status,
      progress: row.progress,
      step: row.step,
      detail: row.detail || null,
      source: row.source,
      sourceIp: row.source_ip,
      deviceId: row.device_id,
      userAgent: row.user_agent,
      geo: row.geo_json ? JSON.parse(row.geo_json) : null,
      request: JSON.parse(row.request_json || '{}'),
      result: row.result_json ? JSON.parse(row.result_json) : null,
      error: row.error_json ? JSON.parse(row.error_json) : null,
      attempt: row.attempt,
      createdAt: row.created_at,
      queuedAt: row.queued_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      updatedAt: row.updated_at
    };
  }

  mapFeedback(row) {
    if (!row) return null;
    return {
      id: row.id, deviceId: row.device_id, sourceIp: row.source_ip, userAgent: row.user_agent,
      geo: row.geo_json ? JSON.parse(row.geo_json) : null, phone: row.phone || '', wechat: row.wechat || '',
      content: row.content, pageUrl: row.page_url || '', status: row.status, adminNote: row.admin_note || '',
      attachments: row.attachments_json ? JSON.parse(row.attachments_json) : [],
      createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  mapSmsDelivery(row) {
    if (!row) return null;
    return {
      id: row.id, queryId: row.query_id, traceId: row.trace_id, ruleId: row.rule_id,
      matchType: row.match_type, matchValue: row.match_value, to: row.recipient, text: row.message_text,
      idempotencyKey: row.idempotency_key, apiUrl: row.api_url, status: row.status,
      attempts: Number(row.attempts || 0), providerMessageId: row.provider_message_id || '',
      providerStatus: row.provider_status || '', error: row.error || '', createdAt: row.created_at, updatedAt: row.updated_at
    };
  }

  mapSmsBinding(row) {
    if (!row) return null;
    return {
      id: row.id, queryFingerprint: row.query_fingerprint, queryId: row.query_id,
      to: row.recipient, deviceId: row.device_id, sourceIp: row.source_ip, status: row.status,
      codeSalt: row.code_salt, codeHash: row.code_hash, verifyAttempts: Number(row.verify_attempts || 0),
      expiresAt: row.expires_at, resendAfter: row.resend_after, createdAt: row.created_at,
      verifiedAt: row.verified_at || null, intervalHours: Number(row.interval_hours || 168),
      nextRunAt: row.next_run_at || null, lastRunAt: row.last_run_at || null,
      lastQueryId: row.last_query_id || null, scheduleClaimedUntil: row.schedule_claimed_until || null,
      updatedAt: row.updated_at
    };
  }
}
