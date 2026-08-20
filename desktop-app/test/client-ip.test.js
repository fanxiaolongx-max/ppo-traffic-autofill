import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveClientIp } from '../src/client-ip.js';

const config = (trustProxy = true, trusted = []) => ({ trustProxy, trustedProxies: new Set(trusted) });
const request = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });

test('uses a forwarded client IP from a loopback reverse proxy', () => {
  assert.equal(resolveClientIp(request('::ffff:127.0.0.1', { 'x-forwarded-for':'203.0.113.7, 127.0.0.1' }), config()), '203.0.113.7');
  assert.equal(resolveClientIp(request('127.0.0.1', { 'x-real-ip':'198.51.100.9' }), config()), '198.51.100.9');
});

test('prefers the Cloudflare client address supplied by a trusted local proxy', () => {
  assert.equal(resolveClientIp(request('127.0.0.1', { 'cf-connecting-ip':'2001:db8::12', 'x-forwarded-for':'198.51.100.4' }), config()), '2001:db8::12');
});

test('does not trust spoofed forwarding headers from direct clients', () => {
  assert.equal(resolveClientIp(request('192.168.1.50', { 'x-forwarded-for':'8.8.8.8' }), config()), '192.168.1.50');
  assert.equal(resolveClientIp(request('127.0.0.1', { 'x-forwarded-for':'8.8.8.8' }), config(false)), '127.0.0.1');
});

test('supports an explicitly trusted non-loopback proxy', () => {
  assert.equal(resolveClientIp(request('10.0.0.8', { forwarded:'for="[2001:db8::4]";proto=https' }), config(true, ['10.0.0.8'])), '2001:db8::4');
});
