/**
 * File proxy — streams R2 objects through the app server.
 * Used when R2_PUBLIC_URL is NOT set (files aren't on a public bucket).
 * If R2_PUBLIC_URL IS set, the client accesses files directly from R2/CDN
 * and this route is never called in normal operation.
 *
 * GET /api/files/:objectName  — no auth required
 */
const express = require('express');
const { getObjectStream } = require('../db/r2');

const router = express.Router();

router.get('/:objectName', async (req, res, next) => {
  try {
    const { objectName } = req.params;
    if (!objectName || objectName.includes('..') || objectName.includes('/')) {
      return res.status(400).json({ error: 'Invalid object name' });
    }

    const { stream, contentType, contentLength } = await getObjectStream(objectName);

    if (contentType)  res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    stream.pipe(res);
    stream.on('error', next);
  } catch (err) {
    if (err.name === 'NoSuchKey') return res.status(404).json({ error: 'File not found' });
    next(err);
  }
});

module.exports = router;
