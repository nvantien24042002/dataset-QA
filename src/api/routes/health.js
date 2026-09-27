'use strict';

// Health route (v2.md §16.1: GET /api/v2/health). Mounted under /api/v2.

const express = require('express');
const { getHealth } = require('../controllers/healthController');

const router = express.Router();

router.get('/health', getHealth);

module.exports = router;
