import { getTokenRecord, getUserById } from '../db.js'

/**
 * Resolve token from either Authorization header or ?token= query param.
 */
function extractToken(req) {
  if (req.headers.authorization) {
    return req.headers.authorization.replace('Bearer ', '')
  }
  if (req.query?.token) {
    return req.query.token
  }
  return null
}

/**
 * Middleware: optional auth. If a valid token is present, attach req.user.
 * Otherwise continue without error (req.user stays undefined).
 */
export function optionalAuth(req, res, next) {
  const token = extractToken(req)
  if (!token) return next()
  try {
    const record = getTokenRecord(token)
    if (!record) return next()
    const user = getUserById(record.user_id)
    if (user) req.user = user
  } catch {}
  next()
}

/**
 * Middleware: require valid auth token.
 * Token can come from Authorization header OR ?token= query param.
 * Attaches req.user = { id, username, display_name } on success.
 */
export function requireAuth(req, res, next) {
  const token = extractToken(req)
  if (!token) {
    return res.status(401).json({ error: '未登录' })
  }

  try {
    const record = getTokenRecord(token)
    if (!record) {
      return res.status(401).json({ error: 'token 无效或已过期' })
    }

    const user = getUserById(record.user_id)
    if (!user) {
      return res.status(401).json({ error: '用户不存在' })
    }

    req.user = user
    next()
  } catch (err) {
    console.error('[auth middleware] error:', err)
    res.status(500).json({ error: '认证失败' })
  }
}
