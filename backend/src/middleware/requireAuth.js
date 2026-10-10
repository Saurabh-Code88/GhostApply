// src/middleware/requireAuth.js
// JWT auth middleware — attach req.user to all protected routes

import jwt from 'jsonwebtoken'

export function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized — no token' })
  }

  const token = header.slice(7)
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    req.user = { userId: payload.userId, email: payload.email, name: payload.name }
    next()
  } catch {
    return res.status(401).json({ error: 'Unauthorized — invalid or expired token' })
  }
}
