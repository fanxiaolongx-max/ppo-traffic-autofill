import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { StableGateway } from '../src/gateway.js';

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

test('keeps a maintenance page online and proxies to a healthy core', async () => {
  const upstream = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ path: request.url, forwarded: request.headers['x-forwarded-for'] }));
  });
  const upstreamPort = await listen(upstream);
  const gateway = new StableGateway({ host: '127.0.0.1', port: 0, autoIncrement: false });
  try {
    const { port } = await gateway.listen();
    gateway.showMaintenance({ targetVersion: '1.0.10' });
    const maintenance = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    assert.equal(maintenance.status, 503);
    assert.equal((await maintenance.json()).maintenance, true);
    gateway.setTarget(upstreamPort);
    const proxied = await fetch(`http://127.0.0.1:${port}/hello`);
    assert.equal(proxied.status, 200);
    assert.equal((await proxied.json()).path, '/hello');
  } finally {
    await gateway.close();
    await new Promise(resolve => upstream.close(resolve));
  }
});
