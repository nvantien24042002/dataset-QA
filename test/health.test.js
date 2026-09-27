'use strict';

// Phase 1 smoke test: GET /api/health (v1.md §22.1, §24.1 "API health").

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../server');

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('GET /api/health returns 200 and the exact healthy payload', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.strictEqual(res.status, 200);

  const body = await res.json();
  assert.deepStrictEqual(body, { ok: true, status: 'healthy', version: '1.0' });
});
