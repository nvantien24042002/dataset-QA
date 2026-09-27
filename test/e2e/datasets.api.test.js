'use strict';

// Phase 2 API (e2e) test — the §16.1 dataset/version endpoints over a real HTTP
// server built by createApp with an injected in-memory DB and temp data dir.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../../src/app');
const { memDb, tmpDir, writeDataset, PNG_1x1 } = require('../helpers/fixtures');

const COCO = {
  images: [{ id: 1, file_name: 'a.png', width: 1, height: 1 }],
  categories: [{ id: 1, name: 'car' }],
  annotations: [{ id: 1, image_id: 1, category_id: 1, bbox: [0, 0, 1, 1] }],
};

let server;
let base;

before(async () => {
  const app = createApp({ db: memDb(), dataDir: tmpDir('dsqa-api-') });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  if (server) server.close();
});

const post = (p, body) =>
  fetch(`${base}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('V1 health endpoint is preserved (version 1.0)', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.version, '1.0');
});

test('POST version import returns 201 READY, then GET reads it back', async () => {
  const src = writeDataset(tmpDir('dsqa-src-'), { coco: COCO, images: { 'a.png': PNG_1x1 } });

  const res = await post('/api/v2/datasets/ds1/versions', { sourcePath: src, datasetName: 'Cars' });
  assert.strictEqual(res.status, 201);
  const created = await res.json();
  assert.strictEqual(created.status, 'READY');

  const listRes = await fetch(`${base}/api/v2/datasets`);
  assert.strictEqual(listRes.status, 200);
  assert.ok((await listRes.json()).datasets.some((d) => d.id === 'ds1'));

  const verRes = await fetch(`${base}/api/v2/datasets/ds1/versions/${created.id}`);
  assert.strictEqual(verRes.status, 200);
  assert.strictEqual((await verRes.json()).id, created.id);
});

test('GET an unknown dataset returns 404', async () => {
  const res = await fetch(`${base}/api/v2/datasets/nope`);
  assert.strictEqual(res.status, 404);
  assert.strictEqual((await res.json()).error.code, 'NOT_FOUND');
});

test('import missing sourcePath returns 400', async () => {
  const res = await post('/api/v2/datasets/ds2/versions', { datasetName: 'x' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual((await res.json()).error.code, 'BAD_REQUEST');
});

test('import of an incomplete dataset returns 422 and creates no version', async () => {
  const src = writeDataset(tmpDir('dsqa-src-'), { coco: COCO, images: {} }); // image file missing
  const res = await post('/api/v2/datasets/ds3/versions', { sourcePath: src });
  assert.strictEqual(res.status, 422);
  assert.strictEqual((await res.json()).error.code, 'VALIDATION_ERROR');

  // Validation aborts before any DB write, so the dataset was never created.
  const verRes = await fetch(`${base}/api/v2/datasets/ds3/versions`);
  assert.strictEqual(verRes.status, 404);
});
