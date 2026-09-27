'use strict';

// server.js — HTTP / orchestration layer only.
// No QA business logic lives here (see v1.md §26.1, §32). Later phases wire the
// analysis pipeline (parser, QA engine, risk engine) in via src/*.

const path = require('path');
const express = require('express');

const app = express();

// Serve the static dashboard. The frontend files (public/index.html, etc.) are
// built in a later phase (v1.md §20, Phase 8); the directory is served now so
// the HTTP layer is wired up.
app.use(express.static(path.join(__dirname, 'public')));

// GET /api/health — liveness check (v1.md §22.1).
app.get('/api/health', (req, res) => {
  res.status(200).json({ ok: true, status: 'healthy', version: '1.0' });
});

const PORT = process.env.PORT || 3000;

// Only bind a port when run directly (npm start), so tests can import the app
// without occupying a fixed port.
if (require.main === module) {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Dataset QA server listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
