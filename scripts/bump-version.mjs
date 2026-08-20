#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'manifest.json');
const desktopPackagePath = path.join(root, 'desktop-app', 'package.json');
const desktopLockPath = path.join(root, 'desktop-app', 'package-lock.json');
const dryRun = process.argv.includes('--dry-run');
const nextOnly = process.argv.includes('--next');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }

const manifest = readJson(manifestPath);
const desktopPackage = readJson(desktopPackagePath);
const desktopLock = readJson(desktopLockPath);
const current = String(manifest.version || '');
if (!/^\d+\.\d+\.\d+$/.test(current)) throw new Error(`Unsupported version: ${current}`);
if (desktopPackage.version !== current || desktopLock.version !== current || desktopLock.packages?.['']?.version !== current) {
  throw new Error(`Version mismatch before bump: extension=${current}, app=${desktopPackage.version}, lock=${desktopLock.version}, lockRoot=${desktopLock.packages?.['']?.version}`);
}

const parts = current.split('.').map(Number);
parts[2] += 1;
const next = parts.join('.');
if (nextOnly) {
  process.stdout.write(`${next}\n`);
  process.exit(0);
}
if (dryRun) {
  process.stdout.write(`${JSON.stringify({ current, next })}\n`);
  process.exit(0);
}

manifest.version = next;
desktopPackage.version = next;
desktopLock.version = next;
desktopLock.packages[''].version = next;
writeJson(manifestPath, manifest);
writeJson(desktopPackagePath, desktopPackage);
writeJson(desktopLockPath, desktopLock);

const rootReadme = path.join(root, 'README.md');
let rootContent = fs.readFileSync(rootReadme, 'utf8');
rootContent = rootContent
  .replace(/^版本：\*\*\d+\.\d+\.\d+\*\*/m, `版本：**${next}**`)
  .replace(/当前商店版本为 `\d+\.\d+\.\d+`/, `当前商店版本为 \`${next}\``)
  .replaceAll(`ppo-traffic-autofill-chrome-v${current}.zip`, `ppo-traffic-autofill-chrome-v${next}.zip`)
  .replaceAll(`ppo-traffic-autofill-edge-v${current}.zip`, `ppo-traffic-autofill-edge-v${next}.zip`)
  .replaceAll(`v${current}\` 的版本标签`, `v${next}\` 的版本标签`)
  .replaceAll(`低于 \`${current}\``, `低于 \`${next}\``)
  .replaceAll(`发布过 \`${current}\``, `发布过 \`${next}\``);
fs.writeFileSync(rootReadme, rootContent);

const desktopReadme = path.join(root, 'desktop-app', 'README.md');
let desktopContent = fs.readFileSync(desktopReadme, 'utf8');
desktopContent = desktopContent.replace(/\{"version":"\d+\.\d+\.\d+","url":/, `{"version":"${next}","url":`);
fs.writeFileSync(desktopReadme, desktopContent);

process.stdout.write(`${next}\n`);
