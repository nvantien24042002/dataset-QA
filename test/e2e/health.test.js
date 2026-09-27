'use strict';

// Phase 1 E2E test — health endpoints. Confirms the V2 app boots and that the
// V1 endpoint is preserved (v2.md §16.1; rule: preserve existing /api/health).

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../../src/app');

let server;
let baseUrl;

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('GET /api/v2/health returns 200 and healthy payload', async () => {
  const res = await fetch(`${baseUrl}/api/v2/health`);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { ok: true, status: 'healthy', version: '2.0' });
});

test('V1 GET /api/health is preserved', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { ok: true, status: 'healthy', version: '1.0' });
});
