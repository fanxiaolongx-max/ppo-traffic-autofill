import test from 'node:test';
import assert from 'node:assert/strict';
import { IpGeoResolver } from '../src/ip-geo.js';

test('classifies local and LAN addresses without external lookup', async () => {
  const resolver = new IpGeoResolver({ store:{}, config:{ ipGeoEnabled:true }, logger:{ warn(){} } });
  assert.equal((await resolver.lookup('127.0.0.1')).scope, 'loopback');
  assert.equal((await resolver.lookup('192.168.1.20')).scope, 'private');
  assert.equal((await resolver.lookup('fd00::1')).scope, 'private');
  assert.equal((await resolver.lookup('not-an-ip')).scope, 'unknown');
});
