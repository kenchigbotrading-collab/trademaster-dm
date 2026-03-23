// ============================================================
// utils/security.js
// Webhook signature verification + basic rate limiting.
// Protects the /webhook/dm endpoint from abuse.
// ============================================================

const crypto = require('crypto');

// ── In-memory rate limiter (replace with Upstash Redis in prod) ──
// Tracks request counts per IP per minute
const rateLimitStore = new Map();

/**
 * Simple in-memory rate limiter.
 * Allows max 30 requests per IP per minute.
 * For production: replace with Upstash Redis.
 */
function rateLimit(maxRequests = 30, windowMs = 60000) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowStart = now - windowMs;

    if (!rateLimitStore.has(ip)) {
      rateLimitStore.set(ip, []);
    }

    const requests = rateLimitStore.get(ip).filter(ts => ts > windowStart);
    requests.push(now);
    rateLimitStore.set(ip, requests);

    if (requests.length > maxRequests) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    next();
  };
}

/**
 * Verify that the request came from ManyChat by checking
 * a shared secret in the Authorization header.
 *
 * In ManyChat External Request: add header
 * Authorization: Bearer YOUR_WEBHOOK_SECRET
 */
function verifyManychatRequest(req, res, next) {
  const auth = req.headers['authorization'];
  const expected = `Bearer ${process.env.WEBHOOK_SECRET}`;

  if (!process.env.WEBHOOK_SECRET) {
    // If no secret set, skip verification (dev mode)
    console.warn('[Security] WEBHOOK_SECRET not set — skipping verification');
    return next();
  }

  if (!auth || auth !== expected) {
    console.warn(`[Security] Unauthorized webhook request from ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

/**
 * Validates that required fields are present in the DM payload.
 */
function validateDMPayload(req, res, next) {
  const { subscriber_id, message_text } = req.body;

  if (!subscriber_id || typeof subscriber_id !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid subscriber_id' });
  }

  if (!message_text || typeof message_text !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid message_text' });
  }

  // Truncate extremely long messages to prevent prompt injection
  if (message_text.length > 2000) {
    req.body.message_text = message_text.substring(0, 2000) + '...';
  }

  next();
}

/**
 * Basic prompt injection guard.
 * Strips common injection patterns from the message text.
 */
function sanitizeMessage(req, res, next) {
  if (req.body.message_text) {
    req.body.message_text = req.body.message_text
      .replace(/\[SYSTEM\]/gi, '')
      .replace(/\[INST\]/gi, '')
      .replace(/<\|im_start\|>/gi, '')
      .replace(/<\|im_end\|>/gi, '')
      .trim();
  }
  next();
}

module.exports = { rateLimit, verifyManychatRequest, validateDMPayload, sanitizeMessage };
