import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appVersion = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version;

function integer(name, fallback, min = 0) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function bool(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export const config = Object.freeze({
  appRoot,
  appVersion: process.env.PPO_CORE_VERSION || appVersion,
  host: process.env.PPO_HOST || '0.0.0.0',
  port: integer('PPO_PORT', 17654, 0),
  portAutoIncrement: bool('PPO_PORT_AUTO_INCREMENT', true),
  publicBaseUrl: process.env.PPO_PUBLIC_BASE_URL || '',
  desktopToken: process.env.PPO_DESKTOP_TOKEN || '',
  // Safe by default: forwarded IP headers are only accepted from loopback or an
  // explicitly listed reverse proxy, never from a direct public/LAN client.
  trustProxy: bool('PPO_TRUST_PROXY', true),
  trustedProxies: new Set((process.env.PPO_TRUSTED_PROXIES || '').split(',').map(v => v.trim()).filter(Boolean)),
  apiKeys: new Set((process.env.PPO_API_KEYS || '').split(',').map(v => v.trim()).filter(Boolean)),
  corsOrigins: new Set((process.env.PPO_CORS_ORIGINS || '').split(',').map(v => v.trim().replace(/\/$/, '')).filter(Boolean)),
  dataDir: path.resolve(process.env.PPO_DATA_DIR || path.join(appRoot, 'data')),
  logDir: path.resolve(process.env.PPO_LOG_DIR || path.join(appRoot, 'logs')),
  browserHeadless: bool('PPO_BROWSER_HEADLESS', false),
  browserExecutable: process.env.PPO_BROWSER_EXECUTABLE || '',
  queryTimeoutMs: integer('PPO_QUERY_TIMEOUT_MS', 45_000, 5_000),
  maxRetries: integer('PPO_MAX_RETRIES', 1, 0),
  queueMax: integer('PPO_QUEUE_MAX', 10, 1),
  queueTtlMs: integer('PPO_QUEUE_TTL_MS', 900_000, 30_000),
  estimatedTaskMs: integer('PPO_ESTIMATED_TASK_MS', 60_000, 5_000),
  maxEventClients: integer('PPO_MAX_EVENT_CLIENTS', 100, 1),
  maxEventClientsPerIp: integer('PPO_MAX_EVENT_CLIENTS_PER_IP', 5, 1),
  eventClientMinAgeMs: integer('PPO_EVENT_CLIENT_MIN_AGE_MS', 600_000, 60_000),
  eventClientMaxAgeMs: integer('PPO_EVENT_CLIENT_MAX_AGE_MS', 900_000, 60_000),
  ipSubmissionPerMinute: integer('PPO_IP_SUBMISSIONS_PER_MINUTE', 10, 1),
  ipPerMinute: integer('PPO_IP_PER_MINUTE', 2, 1),
  ipPerDay: integer('PPO_IP_PER_DAY', 30, 1),
  deviceCooldownMs: integer('PPO_DEVICE_COOLDOWN_MS', 25_000, 0),
  dedupeWindowMs: integer('PPO_DEDUPE_WINDOW_MS', 120_000, 0),
  circuitFailures: integer('PPO_CIRCUIT_FAILURES', 5, 1),
  circuitCooldownMs: integer('PPO_CIRCUIT_COOLDOWN_MS', 300_000, 10_000),
  historyLimit: integer('PPO_HISTORY_LIMIT', 100, 1),
  logRetentionDays: integer('PPO_LOG_RETENTION_DAYS', 90, 1),
  adminPassword: process.env.PPO_ADMIN_PASSWORD || '',
  adminSessionHours: integer('PPO_ADMIN_SESSION_HOURS', 12, 1),
  adminLoginAttempts: integer('PPO_ADMIN_LOGIN_ATTEMPTS', 5, 1),
  adminLoginWindowMs: integer('PPO_ADMIN_LOGIN_WINDOW_MS', 900_000, 60_000),
  feedbackPerHour: integer('PPO_FEEDBACK_PER_HOUR', 3, 1),
  feedbackPerDay: integer('PPO_FEEDBACK_PER_DAY', 10, 1),
  feedbackAttachmentDir: path.resolve(process.env.PPO_FEEDBACK_ATTACHMENT_DIR || path.join(process.env.PPO_DATA_DIR || path.join(appRoot, 'data'), 'feedback-attachments')),
  feedbackAttachmentMaxFiles: integer('PPO_FEEDBACK_ATTACHMENT_MAX_FILES', 3, 1),
  feedbackAttachmentMaxFileBytes: integer('PPO_FEEDBACK_ATTACHMENT_MAX_FILE_BYTES', 5 * 1024 * 1024, 1024),
  feedbackAttachmentMaxTotalBytes: integer('PPO_FEEDBACK_ATTACHMENT_MAX_TOTAL_BYTES', 10 * 1024 * 1024, 1024),
  ipGeoEnabled: bool('PPO_IP_GEO_ENABLED', true),
  ipGeoEndpoint: process.env.PPO_IP_GEO_ENDPOINT || 'https://ipwho.is',
  ipGeoTimeoutMs: integer('PPO_IP_GEO_TIMEOUT_MS', 3_000, 500),
  ipGeoCacheDays: integer('PPO_IP_GEO_CACHE_DAYS', 30, 1),
  smsApiUrl: process.env.SMS_API_URL || 'https://app.fanxiaolong.uk/api/v1/sms/messages',
  smsApiToken: process.env.SMS_API_TOKEN || '',
  smsTimeoutMs: integer('PPO_SMS_TIMEOUT_MS', 8_000, 1_000),
  smsMaxAttempts: integer('PPO_SMS_MAX_ATTEMPTS', 2, 1),
  smsBindingCodeTtlMs: integer('PPO_SMS_BINDING_CODE_TTL_MS', 10 * 60_000, 60_000),
  smsBindingResendMs: integer('PPO_SMS_BINDING_RESEND_MS', 60_000, 10_000),
  smsBindingVerifyAttempts: integer('PPO_SMS_BINDING_VERIFY_ATTEMPTS', 5, 1),
  smsBindingWindowMs: integer('PPO_SMS_BINDING_WINDOW_MS', 24 * 60 * 60_000, 60_000),
  smsBindingRequestsPerDeviceIp: integer('PPO_SMS_BINDING_REQUESTS_PER_DEVICE_IP', 6, 1),
  smsBindingPhonesPerDeviceIp: integer('PPO_SMS_BINDING_PHONES_PER_DEVICE_IP', 3, 1),
  smsBindingQueriesPerPhone: integer('PPO_SMS_BINDING_QUERIES_PER_PHONE', 5, 1),
  smsScheduleDefaultHours: integer('PPO_SMS_SCHEDULE_DEFAULT_HOURS', 168, 24),
  smsScheduleMaxHours: integer('PPO_SMS_SCHEDULE_MAX_HOURS', 8_760, 24),
  smsSchedulePollMs: integer('PPO_SMS_SCHEDULE_POLL_MS', 30_000, 5_000),
  smsScheduleLeaseMs: integer('PPO_SMS_SCHEDULE_LEASE_MS', 15 * 60_000, 60_000),
  smsScheduleRetryMs: integer('PPO_SMS_SCHEDULE_RETRY_MS', 15 * 60_000, 60_000)
});
