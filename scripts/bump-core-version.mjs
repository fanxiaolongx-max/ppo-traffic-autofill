#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'desktop-app', 'core-version.json');
const value = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(value.version || '')) throw new Error(`Unsupported core version: ${value.version}`);
const parts = value.version.split('.').map(Number);
parts[2] += 1;
value.version = parts.join('.');
if (process.argv.includes('--next')) process.stdout.write(`${value.version}\n`);
else {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  process.stdout.write(`${value.version}\n`);
}
