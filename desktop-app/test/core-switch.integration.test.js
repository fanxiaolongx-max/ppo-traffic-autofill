import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { StableGateway } from '../src/gateway.js';

function makeCore(root, version) {
  fs.mkdirSync(root, { recursive: true });
  fs.cpSync(new URL('../src', import.meta.url), path.join(root, 'src'), { recursive: true });
  fs.cpSync(new URL('../public', import.meta.url), path.join(root, 'public'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version, type: 'module' }));
}

async function importCore(root, version) {
  process.env.PPO_CORE_VERSION = version;
  const entry = pathToFileURL(path.join(root, 'src', 'server.js'));
  entry.searchParams.set('instance', `${version}-${Date.now()}`);
  const module = await import(entry.href);
  return { module, ready: await module.serverReady };
}

test('keeps the stable gateway available while switching between two external cores', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppo-core-switch-'));
  const coreA = path.join(directory, 'core-a');
  const coreB = path.join(directory, 'core-b');
  makeCore(coreA, '1.0.9'); makeCore(coreB, '1.0.10');
  process.env.PPO_DATA_DIR = path.join(directory, 'data');
  process.env.PPO_LOG_DIR = path.join(directory, 'logs');
  process.env.PPO_HOST = '127.0.0.1';
  process.env.PPO_PORT = '0';
  process.env.PPO_PORT_AUTO_INCREMENT = 'false';
  globalThis.__PPO_CORE_SHELL__ = true;
  const gateway = new StableGateway({ host: '127.0.0.1', port: 0, autoIncrement: false });
  let first;
  let second;
  try {
    const exposed = await gateway.listen();
    first = await importCore(coreA, '1.0.9');
    gateway.setTarget(first.ready.port);
    assert.equal((await (await fetch(`http://127.0.0.1:${exposed.port}/api/v1/health`)).json()).version, '1.0.9');
    gateway.showMaintenance({ targetVersion: '1.0.10' });
    assert.equal((await fetch(`http://127.0.0.1:${exposed.port}/api/v1/health`)).status, 503);
    await first.module.prepareForCoreSwitch();
    await first.module.shutdownServer('test_switch');
    second = await importCore(coreB, '1.0.10');
    gateway.setTarget(second.ready.port);
    assert.equal((await (await fetch(`http://127.0.0.1:${exposed.port}/api/v1/health`)).json()).version, '1.0.10');
  } finally {
    await second?.module.shutdownServer('test_complete');
    await gateway.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
