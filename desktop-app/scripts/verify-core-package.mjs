#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CoreManager } from '../src/core-manager.js';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(appRoot, 'core-version.json'), 'utf8')).version;
const shellVersion = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version;
const archive = path.resolve(process.argv[2] || path.join(appRoot, 'dist-core', `ppo-query-core-v${version}.zip`));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-core-verify-'));
try {
  const manager = new CoreManager({
    appRoot, userData: temporary, shellVersion, repository: 'local/verification',
    publicKeyPath: path.join(appRoot, 'assets', 'core-update-public.pem')
  });
  const inspected = manager.inspectArchive(fs.readFileSync(archive));
  if (inspected.version !== version) throw new Error(`Core version mismatch: expected ${version}, got ${inspected.version}`);
  process.stdout.write(`${JSON.stringify({ ok: true, version, files: inspected.manifest.files.length, archive })}\n`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
