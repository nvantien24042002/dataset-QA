'use strict';

// server.js — process entrypoint. Builds the Express app via the application
// factory (src/app.js) and listens. HTTP/orchestration only; no business logic
// (v2.md §15.1, §16). The app itself is defined in src/app.js.

const { createApp } = require('./src/app');

const app = createApp();

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
