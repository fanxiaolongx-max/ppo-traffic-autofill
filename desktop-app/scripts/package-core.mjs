#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(appRoot, '..');
const coreVersion = JSON.parse(fs.readFileSync(path.join(appRoot, 'core-version.json'), 'utf8')).version;
const shellVersion = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version;
const outputDir = path.resolve(process.env.CORE_OUTPUT_DIR || path.join(appRoot, 'dist-core'));
const privateKeyValue = process.env.CORE_SIGNING_PRIVATE_KEY || '';
const privateKeyFile = process.env.CORE_SIGNING_PRIVATE_KEY_FILE || path.join(repositoryRoot, '.local-secrets', 'core-update-private.pem');
const privateKey = privateKeyValue.includes('BEGIN PRIVATE KEY') ? privateKeyValue : (fs.existsSync(privateKeyFile) ? fs.readFileSync(privateKeyFile, 'utf8') : '');

if (!/^\d+\.\d+\.\d+$/.test(coreVersion)) throw new Error(`Invalid core version: ${coreVersion}`);
if (!privateKey) throw new Error('Missing CORE_SIGNING_PRIVATE_KEY or CORE_SIGNING_PRIVATE_KEY_FILE');

const sourceFiles = [
  'admin-auth.js', 'client-ip.js', 'config.js', 'db.js', 'feedback-attachments.js', 'ip-geo.js',
  'logger.js', 'official-error.js', 'query-driver.js', 'queue.js', 'rate-limit.js', 'result-parser.js',
  'secret-store.js', 'server.js', 'sms-notifier.js', 'validation.js'
];

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function listFiles(root, prefix = '') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(root, relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result;
}

function copyFile(relative, staging) {
  const source = path.join(appRoot, relative);
  const target = path.join(staging, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-core-package-'));
try {
  for (const name of sourceFiles) copyFile(`src/${name}`, staging);
  fs.cpSync(path.join(appRoot, 'public'), path.join(staging, 'public'), { recursive: true });
  fs.writeFileSync(path.join(staging, 'package.json'), `${JSON.stringify({ name: 'ppo-query-core', version: coreVersion, private: true, type: 'module' }, null, 2)}\n`);
  const files = listFiles(staging).map(relative => ({
    path: relative,
    size: fs.statSync(path.join(staging, relative)).size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(staging, relative))).digest('hex')
  }));
  const gitDate = spawnSync('git', ['log', '-1', '--format=%cI'], { cwd: repositoryRoot, encoding: 'utf8' }).stdout.trim();
  const payload = {
    schemaVersion: 1,
    version: coreVersion,
    minShellVersion: process.env.CORE_MIN_SHELL_VERSION || shellVersion,
    maxShellVersion: process.env.CORE_MAX_SHELL_VERSION || '',
    createdAt: process.env.CORE_BUILD_TIMESTAMP || gitDate || new Date(0).toISOString(),
    files
  };
  const signature = crypto.sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64');
  fs.writeFileSync(path.join(staging, 'core-manifest.json'), `${JSON.stringify({ ...payload, signature }, null, 2)}\n`);
  fs.mkdirSync(outputDir, { recursive: true });
  const output = path.join(outputDir, `ppo-query-core-v${coreVersion}.zip`);
  fs.rmSync(output, { force: true });
  const zip = spawnSync('zip', ['-X', '-q', '-r', output, '.'], { cwd: staging, encoding: 'utf8' });
  if (zip.status !== 0) throw new Error(zip.stderr || `zip exited with ${zip.status}`);
  process.stdout.write(`${output}\n`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
