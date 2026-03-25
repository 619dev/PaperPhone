/**
 * Calls route — Cloudflare TURN credentials
 * GET /api/calls/turn  → returns ICE servers config
 */
const express = require('express');
const { authMiddleware } = require('../middlewares/auth');

const router = express.Router();
router.use(authMiddleware);

const CF_APP_ID     = process.env.CF_CALLS_APP_ID     || '';
const CF_APP_SECRET = process.env.CF_CALLS_APP_SECRET || '';

/**
 * GET /api/calls/turn
 * Returns an array of RTCIceServer objects.
 * If Cloudflare credentials are configured, fetches live credentials from CF.
 * Otherwise, returns only Google STUN (works on LAN, no NAT traversal).
 */
router.get('/turn', async (req, res, next) => {
  // Always include public STUN as fallback
  const iceServers = [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
  ];

  if (CF_APP_ID && CF_APP_SECRET) {
    try {
      const cfRes = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${CF_APP_ID}/credentials/generate`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${CF_APP_SECRET}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl: 86400 }),
        }
      );
      if (cfRes.ok) {
        const data = await cfRes.json();
        // CF returns { iceServers: [...] }
        if (data.iceServers) {
          iceServers.push(...data.iceServers);
        }
      } else {
        console.warn('Cloudflare TURN credentials fetch failed:', cfRes.status);
      }
    } catch (err) {
      console.warn('Cloudflare TURN error (falling back to STUN only):', err.message);
    }
  }

  res.json({ iceServers });
});

module.exports = router;
