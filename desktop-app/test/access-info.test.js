import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAccessInfo } from '../public/access-info.js';

test('shows the local address and bound port', () => {
  const info = buildAccessInfo(new URL('http://127.0.0.1:17654'), 17654);
  assert.equal(info.origin, 'http://127.0.0.1:17654');
  assert.equal(info.kind, '本机访问');
  assert.equal(info.portText, '端口 17654');
});

test('classifies private network addresses as LAN access', () => {
  const info = buildAccessInfo(new URL('http://192.168.1.20:17654'), 17654);
  assert.equal(info.kind, '局域网访问');
  assert.equal(info.origin, 'http://192.168.1.20:17654');
});

test('shows the public domain without exposing the internal service port', () => {
  const info = buildAccessInfo(new URL('https://query.example.com'), 17654);
  assert.equal(info.origin, 'https://query.example.com');
  assert.equal(info.kind, '公网域名');
  assert.equal(info.portText, '访问端口 443');
});

test('preserves a non-standard public access port', () => {
  const info = buildAccessInfo(new URL('https://query.example.com:8443'), 17654);
  assert.equal(info.accessPort, 8443);
  assert.equal(info.portText, '访问端口 8443');
});
