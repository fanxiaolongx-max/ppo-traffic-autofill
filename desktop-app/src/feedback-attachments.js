import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TYPES = new Map([
  ['image/png', { extension:'png', valid: buffer => buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) }],
  ['image/jpeg', { extension:'jpg', valid: buffer => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
  ['image/webp', { extension:'webp', valid: buffer => buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP' }],
  ['application/pdf', { extension:'pdf', valid: buffer => buffer.subarray(0, 5).toString() === '%PDF-' }],
  ['text/plain', { extension:'txt', valid: buffer => !buffer.includes(0) }]
]);

function invalid(message, code = 'INVALID_FEEDBACK_ATTACHMENT') {
  return Object.assign(new Error(message), { statusCode: 422, code });
}

function safeDisplayName(value, fallback) {
  const name = path.basename(String(value || '')).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
  return name || fallback;
}

export function decodeFeedbackAttachments(value, { maxFiles = 3, maxFileBytes = 5 * 1024 * 1024, maxTotalBytes = 10 * 1024 * 1024 } = {}) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxFiles) throw invalid(`最多只能上传 ${maxFiles} 个附件`, 'FEEDBACK_ATTACHMENT_COUNT');
  let totalBytes = 0;
  return value.map((entry, index) => {
    const mime = String(entry?.mime || '').toLowerCase();
    const type = TYPES.get(mime);
    if (!type) throw invalid('附件仅支持 PNG、JPEG、WebP、PDF、TXT 或 LOG 文件', 'FEEDBACK_ATTACHMENT_TYPE');
    const encoded = String(entry?.data || '');
    if (encoded.length > Math.ceil(maxFileBytes / 3) * 4 + 4) {
      throw invalid(`单个附件不能超过 ${Math.floor(maxFileBytes / 1024 / 1024)} MB`, 'FEEDBACK_ATTACHMENT_SIZE');
    }
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw invalid('附件内容无效或文件过大', 'FEEDBACK_ATTACHMENT_DATA');
    }
    const buffer = Buffer.from(encoded, 'base64');
    if (!buffer.length || buffer.length > maxFileBytes) throw invalid(`单个附件不能超过 ${Math.floor(maxFileBytes / 1024 / 1024)} MB`, 'FEEDBACK_ATTACHMENT_SIZE');
    if (!type.valid(buffer)) throw invalid('附件扩展名、类型或文件内容不一致', 'FEEDBACK_ATTACHMENT_SIGNATURE');
    totalBytes += buffer.length;
    if (totalBytes > maxTotalBytes) throw invalid(`附件总大小不能超过 ${Math.floor(maxTotalBytes / 1024 / 1024)} MB`, 'FEEDBACK_ATTACHMENTS_TOTAL_SIZE');
    const original = safeDisplayName(entry?.name, `attachment-${index + 1}.${type.extension}`);
    const displayName = /\.log$/i.test(original) && mime === 'text/plain' ? original : original.replace(/\.[^.]+$/, '') + `.${type.extension}`;
    const id = crypto.randomUUID();
    return { id, name: displayName, mime, size: buffer.length, storedName: `${id}.${type.extension}`, buffer };
  });
}

export function saveFeedbackAttachments(baseDir, feedbackId, decoded) {
  if (!decoded.length) return [];
  const directory = path.join(baseDir, feedbackId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const written = [];
  try {
    for (const item of decoded) {
      fs.writeFileSync(path.join(directory, item.storedName), item.buffer, { flag:'wx', mode:0o600 });
      written.push(item.storedName);
    }
  } catch (error) {
    for (const name of written) {
      try { fs.unlinkSync(path.join(directory, name)); } catch {}
    }
    throw error;
  }
  return decoded.map(({ buffer, ...metadata }) => metadata);
}

export function feedbackAttachmentPath(baseDir, feedbackId, storedName) {
  if (!/^fb_[0-9a-f-]{36}$/i.test(feedbackId) || !/^[0-9a-f-]{36}\.(?:png|jpg|webp|pdf|txt)$/i.test(storedName)) return '';
  const root = path.resolve(baseDir);
  const resolved = path.resolve(root, feedbackId, storedName);
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : '';
}
