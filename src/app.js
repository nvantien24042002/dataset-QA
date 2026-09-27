'use strict';

// Express application factory (v2.md §19 src/app.js, §16 API boundary).
// Presentation/API layer: wires routes to the app. No business logic, no SQL.

const path = require('path');
const express = require('express');
const v2HealthRoutes = require('./api/routes/health');

function createApp() {
  const app = express();

  // Static dashboard (frontend built in later phases).
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // V1 endpoint preserved (v1.md §22.1). Do not remove — no V2 replacement.
  app.get('/api/health', (req, res) => {
    res.status(200).json({ ok: true, status: 'healthy', version: '1.0' });
  });

  // V2 API (v2.md §16: /api/v2/...).
  app.use('/api/v2', v2HealthRoutes);

  return app;
}

module.exports = { createApp };
