'use strict';

// Health controller (v2.md §16.1). Thin: no business logic (v2.md §16, §15.1).

function getHealth(req, res) {
  res.status(200).json({ ok: true, status: 'healthy', version: '2.0' });
}

module.exports = { getHealth };
