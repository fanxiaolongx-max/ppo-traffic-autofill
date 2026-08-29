import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class SecretStore {
  constructor(dataDir) {
    this.keyPath = path.join(dataDir, '.secrets.key');
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  }

  key() {
    if (!fs.existsSync(this.keyPath)) {
      fs.writeFileSync(this.keyPath, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
    }
    const value = fs.readFileSync(this.keyPath);
    if (value.length !== 32) throw new Error('本地密钥文件格式无效');
    return value;
  }

  encrypt(value) {
    if (!value) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key(), iv);
    const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  }

  decrypt(payload) {
    if (!payload) return '';
    if (payload.version !== 1) throw new Error('不支持的本地密钥版本');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key(), Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  }
}
