# Dataset QA

A local tool for **quality-checking 2D Computer Vision datasets** annotated in the
**COCO JSON** format.

Version 1 (V1) runs entirely on your machine and uses **deterministic, rule-based
checks** over annotation metadata (no image pixels, no AI/LLM, no cloud). It surfaces
*potential* quality signals for a human to review — it does not declare annotations
right or wrong. The full specification and single source of truth is [v1.md](v1.md).

> This README is intentionally minimal for Phase 1 (project skeleton). The complete
> documentation is written in a later phase.

## Requirements

- Node.js 18 or newer (uses the built-in test runner and global `fetch`).

## Install

```bash
npm install
```

## Start the server

```bash
npm start
```

The server listens on `http://localhost:3000` (override with the `PORT` env var).

## Check the health endpoint

```bash
curl http://localhost:3000/api/health
```

Expected response (HTTP 200):

```json
{ "ok": true, "status": "healthy", "version": "1.0" }
```

## Run tests

```bash
npm test
```
