'use strict';

// Express application factory (v2.md §19 src/app.js, §16 API boundary).
// Presentation/API layer: wires routes to the app. No business logic, no SQL —
// service construction is delegated to the composition root.

const path = require('path');
const express = require('express');
const v2HealthRoutes = require('./api/routes/health');
const { createDatabase } = require('./infrastructure/persistence/sqlite/db');
const { buildServices } = require('./composition');
const { createDatasetController } = require('./api/controllers/datasetController');
const { createDatasetRoutes } = require('./api/routes/datasets');
const { errorHandler } = require('./api/middleware/errorHandler');

/**
 * @param {object} [options]
 * @param {import('better-sqlite3').Database} [options.db] - inject a connection (tests)
 * @param {string} [options.dataDir] - storage root; defaults to <repo>/data
 */
function createApp(options = {}) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Static dashboard (frontend built in later phases).
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // V1 endpoint preserved (v1.md §22.1). Do not remove — no V2 replacement.
  app.get('/api/health', (req, res) => {
    res.status(200).json({ ok: true, status: 'healthy', version: '1.0' });
  });

  // V2 API (v2.md §16: /api/v2/...).
  app.use('/api/v2', v2HealthRoutes);

  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const db = options.db || createDatabase(process.env.DB_PATH || path.join(dataDir, 'app.db'));
  const { datasetService, importService, sourceReaderFactory } = buildServices({ db, dataDir });
  const datasetController = createDatasetController({ datasetService, importService, sourceReaderFactory });
  app.use('/api/v2', createDatasetRoutes(datasetController));

  // Error contract mapper — must be last (v2.md §16.3).
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
