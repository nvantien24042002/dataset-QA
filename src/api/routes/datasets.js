'use strict';

// Dataset routes (v2.md §16.1). Mounted under /api/v2. Route → controller only.

const express = require('express');

function createDatasetRoutes(controller) {
  const router = express.Router();
  router.get('/datasets', controller.list);
  router.get('/datasets/:id', controller.get);
  router.get('/datasets/:id/versions', controller.listVersions);
  router.post('/datasets/:id/versions', controller.createVersion);
  router.get('/datasets/:id/versions/:versionId', controller.getVersion);
  return router;
}

module.exports = { createDatasetRoutes };
