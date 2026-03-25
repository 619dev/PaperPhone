const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { signToken, authMiddleware };
