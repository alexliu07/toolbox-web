import express from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import {
  createUser,
  getUserByUsername,
  updateLastLogin,
  createToken,
  deleteToken,
  cleanExpiredTokens,
  getTokenRecord,
  getUserById,
} from '../db.js'

const router = express.Router()

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, password, displayName } = req.body
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' })
  }
  if (username.length < 2 || username.length > 32) {
    return res.status(400).json({ error: '用户名长度需在 2~32 字符之间' })
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少需要 6 位' })
  }
  if (!/^[a-zA-Z0-9_\-.]+$/.test(username)) {
    return res.status(400).json({ error: '用户名只能包含字母、数字、下划线、连字符和点' })
  }

  try {
    const existing = getUserByUsername(username)
    if (existing) {
      return res.status(409).json({ error: '用户名已存在' })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const name = displayName?.trim() || username
    const userId = createUser(username, passwordHash, name)

    const token = crypto.randomBytes(32).toString('hex')
    createToken(userId, token)
    updateLastLogin(userId)

    res.json({ token, username, displayName: name })
  } catch (err) {
    console.error('[auth] register error:', err)
    res.status(500).json({ error: '注册失败' })
  }
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' })
  }

  try {
    cleanExpiredTokens()

    const user = getUserByUsername(username)
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' })
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      return res.status(401).json({ error: '用户名或密码错误' })
    }

    const token = crypto.randomBytes(32).toString('hex')
    createToken(user.id, token)
    updateLastLogin(user.id)

    res.json({ token, username: user.username, displayName: user.display_name })
  } catch (err) {
    console.error('[auth] login error:', err)
    res.status(500).json({ error: '登录失败' })
  }
})

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (token) {
    try {
      deleteToken(token)
    } catch (err) {
      console.error('[auth] logout error:', err)
    }
  }
  res.json({ ok: true })
})

// GET /api/auth/me — verify token and return user info
router.get('/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
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

    res.json({ username: user.username, displayName: user.display_name })
  } catch (err) {
    console.error('[auth] me error:', err)
    res.status(500).json({ error: '验证失败' })
  }
})

export default router
